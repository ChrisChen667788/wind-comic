/**
 * GET /api/templates · v9.6.8 (阶段十六 T2 模板市场)
 *
 * 模板市场:列出公开模板,支持 ?q=&genre=&style=&minQuality= 过滤(复用 lib/template-market.searchTemplates
 * 的相关度·质量排序)。只读。
 */
import { NextResponse } from 'next/server';
import { listMarketTemplates } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minQualityRaw = url.searchParams.get('minQuality');
  const templates = await listMarketTemplates({
    query: url.searchParams.get('q') || undefined,
    genre: url.searchParams.get('genre') || undefined,
    style: url.searchParams.get('style') || undefined,
    minQuality: minQualityRaw != null && minQualityRaw !== '' ? Number(minQualityRaw) : undefined,
  }, { limit: 60 });
  return NextResponse.json({ templates });
}
