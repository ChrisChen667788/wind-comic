import { NextRequest, NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver'; // v9.0.4: 双驱动
import { getUserFromRequest } from '../../../auth/lib';
import { loadTeam } from '../../lib';
import { canAcceptInvite, memberFromInvite, type TeamInvite } from '@/lib/team-invite';
import { capAllocationToPool } from '@/lib/team-credits';

export const runtime = 'nodejs';

/**
 * v6.5.1 — 接受团队邀请 (真·多用户).
 * POST { token } (须已登录) → 校验邀请有效 → 以接受者真实 user id 进成员表 → 标记邀请已接受.
 * **不创建账号**: 未登录 → 401, 引导先登录.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ message: 'token 必填' }, { status: 400 });

  const payload = getUserFromRequest(request);
  if (!payload?.sub) {
    return NextResponse.json({ message: '请先登录后再接受邀请' }, { status: 401 });
  }

  const r = await getDbDriver().get<any>('SELECT * FROM team_invites WHERE token = ?', [token]);
  if (!r) return NextResponse.json({ message: '邀请不存在' }, { status: 404 });
  const invite: TeamInvite = {
    token: r.token, ownerUserId: r.owner_user_id, email: r.email, role: r.role,
    allocated: r.allocated, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
    acceptedBy: r.accepted_by, acceptedAt: r.accepted_at,
  };
  const chk = canAcceptInvite(invite, new Date().toISOString());
  if (!chk.ok) return NextResponse.json({ message: chk.reason }, { status: 400 });

  const user = await getDbDriver().get<{ id: string; name?: string; email?: string }>(
    'SELECT id, name, email FROM users WHERE id = ?', [payload.sub]);
  const accepter = user || { id: payload.sub };

  const { pool, members } = await loadTeam(invite.ownerUserId);
  // 防超池: 期望额度收敛到 (不含自己的) 剩余可分
  const others = members.filter((m) => m.id !== accepter.id);
  const cap = capAllocationToPool(pool, others, invite.allocated);
  const existing = members.find((m) => m.id === accepter.id);
  const nextMembers = existing
    ? members.map((m) => (m.id === accepter.id ? { ...m, role: invite.role, allocated: cap } : m))
    : [...members, memberFromInvite(invite, accepter, cap)];

  // v9.0.4: team_allocations upsert + team_invites 标记接受 跨表原子 (DbDriver.transaction)
  const tsAccept = new Date().toISOString();
  await getDbDriver().transaction(async (tx) => {
    await tx.run(
      `INSERT INTO team_allocations (owner_user_id, pool_credits, allocations, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_user_id) DO UPDATE SET pool_credits = excluded.pool_credits, allocations = excluded.allocations, updated_at = excluded.updated_at`,
      [invite.ownerUserId, pool, JSON.stringify(nextMembers), tsAccept],
    );
    await tx.run(
      'UPDATE team_invites SET status = ?, accepted_by = ?, accepted_at = ? WHERE token = ?',
      ['accepted', accepter.id, tsAccept, token],
    );
  });

  return NextResponse.json({ ok: true, member: nextMembers.find((m) => m.id === accepter.id), allocated: cap });
}
