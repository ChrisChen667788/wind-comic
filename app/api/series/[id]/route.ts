/**
 * GET /api/series/[id] (阶段二十六 · v12.17.0) —— 列出某系列的全部剧集(按集号升序)。
 * 安全:登录;只返回本人名下该系列的集。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { listSeriesEpisodes } from '@/lib/repos/series-repo';
import { listAssetsByType } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function urlOf(a: any): string | null {
  if (!a) return null;
  if (a.persistent_url) return a.persistent_url;
  try { const m = JSON.parse(a.media_urls || '[]'); return Array.isArray(m) ? (m[0] ?? null) : null; } catch { return null; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const episodes = await listSeriesEpisodes(id, payload.sub);
  // v12.25.0:季级产物(封面 + 整季合集)挂在锚点集(集号最小)上
  let seasonCover: string | null = null;
  let seasonVideo: string | null = null;
  if (episodes.length > 0) {
    const anchorId = episodes[0].id;
    seasonCover = urlOf((await listAssetsByType(anchorId, 'season_cover'))[0]);
    seasonVideo = urlOf((await listAssetsByType(anchorId, 'season_video'))[0]);
  }
  return NextResponse.json({ ok: true, seriesId: id, episodes, seasonCover, seasonVideo });
}
