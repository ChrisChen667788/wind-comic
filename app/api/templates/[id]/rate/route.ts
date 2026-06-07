/**
 * POST /api/templates/[id]/rate · v9.7.16 — 用户给模板评分(1-5,去重)。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../../auth/lib';
import { rateTemplate } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';

async function resolveUser(request: Request): Promise<string> {
  const sub = getUserFromRequest(request)?.sub;
  if (sub) return sub;
  const first = await getDbDriver().get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', []);
  return first?.id || 'demo-user';
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { rating?: number };
  const rating = Number(body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating 需 1-5' }, { status: 400 });
  }
  const userId = await resolveUser(request);
  const agg = await rateTemplate(id, userId, rating);
  if (!agg) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  return NextResponse.json({ ok: true, ...agg, yourRating: Math.round(rating) });
}
