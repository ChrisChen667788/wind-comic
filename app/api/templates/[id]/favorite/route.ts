/**
 * POST /api/templates/[id]/favorite · v9.7.16 — 收藏 / 取消收藏(body.on)。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../../auth/lib';
import { toggleFavorite } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';

async function resolveUser(request: Request): Promise<string> {
  const sub = getUserFromRequest(request)?.sub;
  if (sub) return sub;
  const first = await getDbDriver().get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', []);
  return first?.id || 'demo-user';
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { on?: boolean };
  const userId = await resolveUser(request);
  const favorited = await toggleFavorite(userId, id, body?.on !== false);
  return NextResponse.json({ ok: true, favorited });
}
