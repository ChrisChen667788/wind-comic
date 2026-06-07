/**
 * GET /api/templates · v9.6.8 / v9.7.16 (阶段十六 T2 模板市场)
 *
 * 列出公开模板,?q=&genre=&style=&minQuality= 过滤(复用 lib/template-market.searchTemplates)。
 * v9.7.16:?fav=1 只看当前用户收藏;并返 `favoriteIds`(当前用户收藏集)给前端标心。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../auth/lib';
import { listMarketTemplates, listFavoriteTemplates, listFavoriteIds, type StoredTemplate } from '@/lib/repos/template-repo';
import { searchTemplates } from '@/lib/template-market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveUser(request: Request): Promise<string> {
  const sub = getUserFromRequest(request)?.sub;
  if (sub) return sub;
  const first = await getDbDriver().get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', []);
  return first?.id || 'demo-user';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minQualityRaw = url.searchParams.get('minQuality');
  const query = {
    query: url.searchParams.get('q') || undefined,
    genre: url.searchParams.get('genre') || undefined,
    style: url.searchParams.get('style') || undefined,
    minQuality: minQualityRaw != null && minQualityRaw !== '' ? Number(minQualityRaw) : undefined,
  };

  const userId = await resolveUser(request);
  let templates: StoredTemplate[];
  if (url.searchParams.get('fav') === '1') {
    // 我的收藏(经同一套过滤/排序)
    templates = searchTemplates(await listFavoriteTemplates(userId), query) as StoredTemplate[];
  } else {
    templates = await listMarketTemplates(query, { limit: 60 });
  }
  const favoriteIds = await listFavoriteIds(userId);
  return NextResponse.json({ templates, favoriteIds });
}
