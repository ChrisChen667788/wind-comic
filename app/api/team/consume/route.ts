import { NextRequest, NextResponse } from 'next/server';
import { ownerId, loadTeam, saveTeam } from '../lib';
import { consume, costOf, poolSummary } from '@/lib/team-credits';

export const runtime = 'nodejs';

/**
 * v6.5.1 — 成员消费按额度扣减.
 * POST { memberId, cost? | kind?, units? } → 校验剩余够 → cost 计入该成员 used → 落库.
 * 余额不足 / 成员不存在 → 400.
 */
export async function POST(request: NextRequest) {
  const owner = await ownerId(request);
  const body = await request.json().catch(() => ({} as any));
  const memberId = typeof body?.memberId === 'string' ? body.memberId.trim() : '';
  if (!memberId) return NextResponse.json({ message: 'memberId 必填' }, { status: 400 });

  const cost = Number.isFinite(body?.cost)
    ? Math.max(0, Math.floor(body.cost))
    : costOf(String(body?.kind || 'image'), Number.isFinite(body?.units) ? body.units : 1);

  const { pool, members } = await loadTeam(owner);
  const res = consume(members, memberId, cost);
  if (!res.ok) return NextResponse.json({ message: res.reason, cost }, { status: 400 });

  await saveTeam(owner, pool, res.members!);
  return NextResponse.json({ ok: true, cost, member: res.member, summary: poolSummary(pool, res.members!) });
}
