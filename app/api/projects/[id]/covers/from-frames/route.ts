/**
 * /api/projects/[id]/covers/from-frames (v12.113.0) — 成片抽帧封面精选。
 *
 * POST { n?, choose? } → 读 final_video 本地文件 → 12%–80% 均匀抽 n 帧(默认 4)
 *   → VLM 打分(shot-quality-gate,自带跨网关兜底)→ 排序落 cover-candidates
 *   (source:'frame',与 T2I 候选同结构,covers/choose 直接可选)。
 *   choose=true 时最佳帧直接落 chosen-cover(publish-package 自动优先用)。
 * 零 T2I 额度消耗;VLM 全挂时按采样序返回(scored:false)。
 */
import { NextResponse } from 'next/server';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveFFmpegPath } from '@/lib/ffmpeg-bin';
import { getUserFromRequest } from '../../../../auth/lib';
import { db } from '@/lib/db';
import { canEditProject } from '@/lib/project-share';
import { deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { pickFrameTimes, rankCoverFrames, type CoverFrameScore } from '@/lib/cover-frames';
import { getTitleSafeArea } from '@/lib/cover-candidates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function localPathFromUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const m = u.match(/serve-file\?path=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (u.startsWith('/') && fs.existsSync(u)) return u;
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  if (proj.user_id !== payload.sub && !(await canEditProject(id, payload.sub))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any = {}; try { body = await request.json(); } catch { /* 空 body 允许 */ }
  const n = Number.isInteger(body?.n) ? body.n : 4;

  const finalRow = db.prepare(
    `SELECT persistent_url, media_urls FROM project_assets WHERE project_id = ? AND type = 'final_video' ORDER BY version DESC LIMIT 1`,
  ).get(id) as any;
  let videoPath = localPathFromUrl(finalRow?.persistent_url);
  if (!videoPath) {
    try { videoPath = localPathFromUrl(JSON.parse(finalRow?.media_urls || '[]')[0]); } catch { /* ignore */ }
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    return NextResponse.json({ error: '没有可用的成片(final_video),先合成再精选封面' }, { status: 400 });
  }

  const { probeVideoIntegrity } = await import('@/services/video-composer');
  const probe = await probeVideoIntegrity(videoPath);
  if (!probe.ok || !probe.durationSec) {
    return NextResponse.json({ error: `成片不可读: ${probe.reason || 'no-duration'}` }, { status: 500 });
  }

  const outDir = path.join(process.cwd(), 'data', 'covers', id);
  fs.mkdirSync(outDir, { recursive: true });
  const times = pickFrameTimes(probe.durationSec, n);
  const { scoreShotStyle } = await import('@/lib/shot-quality-gate');

  const frames: CoverFrameScore[] = [];
  for (const t of times) {
    const file = path.join(outDir, `frame-${String(t).replace('.', '_')}.png`);
    try {
      execFileSync(resolveFFmpegPath(), ['-y', '-v', 'error', '-ss', String(t), '-i', videoPath, '-frames:v', '1', file], { stdio: 'pipe', timeout: 30_000 });
      if (!fs.existsSync(file)) continue;
      const s = await scoreShotStyle(file);
      frames.push({
        url: `${serveFilePathUrl(file)}`,
        timeSec: t,
        quality: s?.quality ?? 0,
        hasBakedText: s?.hasBakedText ?? false,
        scored: !!s,
      });
    } catch (e) {
      console.warn(`[CoverFrames] t=${t}s 抽帧失败:`, e instanceof Error ? e.message.slice(0, 60) : e);
    }
  }
  if (frames.length === 0) return NextResponse.json({ error: '抽帧全部失败' }, { status: 500 });

  const ranked = rankCoverFrames(frames);
  console.log(`[CoverFrames] v12.113 ${frames.length} 帧打分完成,最佳 t=${ranked[0].timeSec}s q=${ranked[0].quality}`);

  const safeArea = getTitleSafeArea();
  const candidates = ranked.map((f, i) => ({ imageUrl: f.url, prompt: `成片高光帧 t=${f.timeSec}s`, score: f.quality, hasBakedText: f.hasBakedText, scored: f.scored, rank: i + 1, source: 'frame' }));
  await deleteAssetsByType(id, 'cover-candidates');
  await createAsset({ projectId: id, type: 'cover-candidates', name: '封面候选(成片帧)', data: { candidates, safeArea, source: 'frame', generatedAt: new Date().toISOString() }, mediaUrls: candidates.map((c) => c.imageUrl) });

  let chosen: string | null = null;
  if (body?.choose === true) {
    await deleteAssetsByType(id, 'chosen-cover');
    await createAsset({ projectId: id, type: 'chosen-cover', name: '定版封面(成片帧)', data: { source: 'frame', timeSec: ranked[0].timeSec, quality: ranked[0].quality }, mediaUrls: [ranked[0].url], persistentUrl: ranked[0].url });
    chosen = ranked[0].url;
  }

  return NextResponse.json({ candidates, safeArea, chosen, videoDurationSec: probe.durationSec });
}
