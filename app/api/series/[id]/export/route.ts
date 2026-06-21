/**
 * POST /api/series/[id]/export (阶段二十六 · v12.25.0 / 评审加固 v12.26.0) —— 一键导出整季合集。
 * 把本系列**已完成**各集成片按集号拼成一条整季视频(归一画幅 + 重编码),持久化后存为锚点集的
 * `season_video` 资产。安全:登录 + 只动本人系列。
 *
 * v12.26.0 加固:① 输出走 persistAsset 落盘(不再存 /tmp 临时路径 → 重启后 404);
 * ② 用完清理 tmpDir(防磁盘泄漏);③ per-series 并发锁(防多个 ffmpeg 同跑刷资源);
 * ④ 返回 skipped(无成片被跳过的集);⑤ 画幅取已完成集。
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodes } from '@/lib/repos/series-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_EPISODES = 20;
const inFlight = new Set<string>(); // 进程内 per-series 导出锁

function urlOf(a: any): string | undefined {
  if (!a) return undefined;
  if (a.persistent_url) return a.persistent_url;
  try { const m = JSON.parse(a.media_urls || '[]'); return Array.isArray(m) ? m[0] : undefined; } catch { return undefined; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eps = await listSeriesEpisodes(id, payload.sub);
  if (eps.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });
  const completed = eps.filter((e) => e.status === 'completed').slice(0, MAX_EPISODES);
  if (completed.length === 0) return NextResponse.json({ error: '还没有已完成的剧集,先批量生成' }, { status: 400 });

  // 并发锁:同一系列正在导出 → 409(防多 Tab/脚本并发起多个 ffmpeg)
  if (inFlight.has(id)) return NextResponse.json({ error: '该系列正在导出中,请稍候' }, { status: 409 });
  inFlight.add(id);

  // 按集号收集各集成片 URL;无成片的集记入 skipped
  const urls: string[] = [];
  const skipped: number[] = [];
  for (const ep of completed) {
    const u = urlOf((await listAssetsByType(ep.id, 'final_video'))[0]);
    if (u) urls.push(u); else skipped.push(ep.episode_number ?? 0);
  }
  if (urls.length === 0) { inFlight.delete(id); return NextResponse.json({ error: '已完成剧集均无成片文件' }, { status: 400 }); }

  const anchor = eps[0];               // 季产物挂集号最小的锚点集(GET 也从这读,保持一致)
  const aspect = completed[0].aspect || anchor.aspect || '16:9'; // 画幅取真实已完成集
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-export-'));
  try {
    const { concatVideos } = await import('@/services/video-composer');
    const { outputPath, count } = await concatVideos(urls, aspect, tmpDir);
    // 持久化:从 tmp 落到 storage(否则重启/清理后 URL 失效);失败兜底用 tmp serve-file URL
    const tmpUrl = `/api/serve-file?path=${encodeURIComponent(outputPath)}`;
    const persisted = await persistAsset(tmpUrl, { ext: 'mp4' }).catch(() => null);
    const videoUrl = persisted?.url || tmpUrl;
    await upsertAsset({
      projectId: anchor.id, type: 'season_video', name: '整季合集',
      data: { seriesId: id, count, aspect, skipped }, mediaUrls: [videoUrl], persistentUrl: persisted?.url || null,
    });
    return NextResponse.json({ ok: true, videoUrl, count, skipped });
  } catch (e) {
    return NextResponse.json({ error: '合集导出失败: ' + (e instanceof Error ? e.message : String(e)).slice(0, 160) }, { status: 502 });
  } finally {
    inFlight.delete(id);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理临时目录,防磁盘泄漏 */ }
  }
}
