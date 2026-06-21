/**
 * POST /api/series/[id]/export (阶段二十六 · v12.25.0) —— 一键导出整季合集。
 * 把本系列**已完成**各集成片按集号拼成一条整季视频(归一画幅 + 重编码),存为锚点集的
 * `season_video` 资产。安全:登录 + 只动本人系列。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodes } from '@/lib/repos/series-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_EPISODES = 20; // 单次合集封顶,防超长 ffmpeg

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

  // 按集号收集各集成片 URL
  const urls: string[] = [];
  for (const ep of completed) {
    const assets = await listAssetsByType(ep.id, 'final_video');
    const u = urlOf(assets[0]);
    if (u) urls.push(u);
  }
  if (urls.length === 0) return NextResponse.json({ error: '已完成剧集均无成片文件' }, { status: 400 });

  const anchor = eps[0]; // 集号最小,整季产物挂这
  const aspect = anchor.aspect || '16:9';
  try {
    const { concatVideos } = await import('@/services/video-composer');
    const { outputPath, count } = await concatVideos(urls, aspect);
    const videoUrl = `/api/serve-file?path=${encodeURIComponent(outputPath)}`;
    await upsertAsset({ projectId: anchor.id, type: 'season_video', name: '整季合集', data: { seriesId: id, count, aspect }, mediaUrls: [videoUrl], persistentUrl: null });
    return NextResponse.json({ ok: true, videoUrl, count });
  } catch (e) {
    return NextResponse.json({ error: '合集导出失败: ' + (e instanceof Error ? e.message : String(e)).slice(0, 160) }, { status: 502 });
  }
}
