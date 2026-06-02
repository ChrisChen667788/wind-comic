/**
 * GET /api/preview-shot/history?limit=30 · v2.18 P2.2
 * DELETE /api/preview-shot/history?id=xxx — 删除某条历史
 *
 * 当前用户的试拍历史 (按 created_at DESC). 同时返回当天 quota 状态供 UI 显示。
 *
 * 出参:
 *   200 → { entries: PreviewHistoryEntry[], quota: { tier, used, limit, remaining } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { getQuotaState, listForUser, deletePreview, type Tier } from '@/lib/preview-history';
import { checkPlan } from '@/lib/plan-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function GET(request: NextRequest) {
  const userId = resolveUserId(request);
  const limit = Number(request.nextUrl.searchParams.get('limit') || 30);

  const tierProbe = checkPlan(request, 'free');
  const tier: Tier = (tierProbe.current as Tier) || 'free';

  const entries = await listForUser(userId, limit);
  const quota = await getQuotaState(userId, tier);

  return NextResponse.json({
    entries,
    quota,
  });
}

export async function DELETE(request: NextRequest) {
  const userId = resolveUserId(request);
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺 id' }, { status: 400 });
  const ok = await deletePreview(id, userId);
  if (!ok) return NextResponse.json({ error: '记录不存在或不属于当前用户' }, { status: 404 });
  return NextResponse.json({ deleted: true, id });
}
