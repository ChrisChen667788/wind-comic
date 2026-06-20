/**
 * GET /api/series/[id] (阶段二十六 · v12.17.0) —— 列出某系列的全部剧集(按集号升序)。
 * 安全:登录;只返回本人名下该系列的集。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { listSeriesEpisodes } from '@/lib/repos/series-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const episodes = await listSeriesEpisodes(id, payload.sub);
  return NextResponse.json({ ok: true, seriesId: id, episodes });
}
