/**
 * /api/projects/[id]/export-platform  · v3.5.1
 *
 * POST 把项目成片导出成目标平台版本 (横竖屏 + 平台字幕).
 * body: { aspect: '9:16'|'16:9'|'1:1'|'4:5', fit?, subtitlePlatform? }
 *
 * 读 final_video 资产 → 解析本地路径 → exportForPlatform → 返回 serve-file URL.
 * 这是 additive 后处理, 不动 composeVideo 主流程.
 *
 * Auth: 登录用户.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { getUserFromRequest } from '../../../auth/lib';
import { db } from '@/lib/db';
import { exportForPlatform } from '@/services/video-export-service';
import { pickRemoteVideoUrl, downloadToTempFile } from '@/lib/remote-media';
import type { ExportAspect, FitMode } from '@/lib/video-export';
import type { SubtitlePlatform } from '@/lib/subtitle-burn';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_ASPECTS: ExportAspect[] = ['16:9', '9:16', '1:1', '4:5'];
const VALID_FITS: FitMode[] = ['contain', 'cover', 'blur-pad'];

/** serve-file?path= / 本地路径 → 本地绝对路径(存在才返回). */
function toLocalPath(u: string | null | undefined): string | null {
  if (typeof u !== 'string' || !u) return null;
  if (u.startsWith('/api/serve-file')) {
    try {
      const p = new URL(u, 'http://localhost').searchParams.get('path');
      if (p && fs.existsSync(p)) return p;
    } catch { /* ignore */ }
    return null;
  }
  if (u.startsWith('/') && !u.startsWith('/api/') && fs.existsSync(u)) return u;
  return null;
}

/** 从 media_urls 里抽出本地绝对路径. */
function extractLocalPath(mediaUrls: string[]): string | null {
  for (const u of mediaUrls) { const p = toLocalPath(u); if (p) return p; }
  return null;
}

/** v12.3.0: 取项目 narration 的 SRT 本地路径(persistent_url=srtUrl),供平台成片烧字幕. */
function resolveProjectSrtPath(projectId: string): string | null {
  const row = db
    .prepare(`SELECT persistent_url, data FROM project_assets WHERE project_id = ? AND type = 'narration' ORDER BY version DESC LIMIT 1`)
    .get(projectId) as any;
  if (!row) return null;
  let srtUrl: string | null = row.persistent_url || null;
  if (!srtUrl) { try { srtUrl = JSON.parse(row.data || '{}')?.srtUrl || null; } catch { /* ignore */ } }
  return toLocalPath(srtUrl);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const aspect = body?.aspect as ExportAspect;
  if (!VALID_ASPECTS.includes(aspect)) {
    return NextResponse.json({ error: `aspect 必须是 ${VALID_ASPECTS.join(' / ')}` }, { status: 400 });
  }
  const fit: FitMode = VALID_FITS.includes(body?.fit) ? body.fit : 'blur-pad';
  const subtitlePlatform = typeof body?.subtitlePlatform === 'string'
    ? (body.subtitlePlatform as SubtitlePlatform) : undefined;

  // 找 final_video 资产
  const finalRow = db
    .prepare(`SELECT data, media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = 'final_video' ORDER BY version DESC LIMIT 1`)
    .get(id) as any;
  if (!finalRow) {
    return NextResponse.json({ error: '该项目还没有成片, 无法导出' }, { status: 400 });
  }

  let mediaUrls: string[] = [];
  try { mediaUrls = JSON.parse(finalRow.media_urls || '[]'); } catch { /* ignore */ }

  // 优先本地源;v12.3.4: 本地没有但有远端/云 URL(persistent_url 或 media_urls 里的 http(s))→ 先下载到临时文件再 encode
  let inputPath = extractLocalPath(mediaUrls);
  let tempInput: string | null = null;
  if (!inputPath) {
    const remote = pickRemoteVideoUrl([...mediaUrls, finalRow.persistent_url]);
    if (remote) {
      try { inputPath = tempInput = await downloadToTempFile(remote, { ext: '.mp4' }); }
      catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? `云成片下载失败: ${e.message.slice(0, 160)}` : '云成片下载失败' },
          { status: 502 },
        );
      }
    }
  }
  if (!inputPath) {
    return NextResponse.json({ error: '成片源文件不在本地且无可下载的远端 URL (可能是占位), 无法平台导出' }, { status: 400 });
  }

  // v12.3.0: 自动接入 SRT —— 指定了平台字幕样式就从 narration 资产取 SRT 路径烧入(此前从不传 → 字幕从未真烧)
  const subtitlePath = subtitlePlatform ? (resolveProjectSrtPath(id) ?? undefined) : undefined;

  try {
    const result = await exportForPlatform({ inputPath, aspect, fit, subtitlePlatform, subtitlePath });
    return NextResponse.json({
      projectId: id,
      aspect: result.aspect,
      width: result.width,
      height: result.height,
      url: `/api/serve-file?path=${encodeURIComponent(result.outputPath)}`,
      subtitled: !!subtitlePath, // v12.3.0: 是否真烧了字幕(平台样式 + 找到 SRT)
      fromRemote: !!tempInput,   // v12.3.4: 源是云/远端成片(已下载到临时文件再导)
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 200) : 'export failed' },
      { status: 500 },
    );
  } finally {
    if (tempInput) { try { fs.unlinkSync(tempInput); } catch { /* 临时文件清理失败不致命 */ } }
  }
}
