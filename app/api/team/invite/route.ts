import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getDbDriver } from '@/lib/db-driver'; // v9.0.4: 双驱动
import { ownerId, loadTeam } from '../lib';
import { isAssignableRole, buildInvite, effectiveInviteStatus, type TeamInvite } from '@/lib/team-invite';
import { capAllocationToPool } from '@/lib/team-credits';

export const runtime = 'nodejs';

function rowToInvite(r: any): TeamInvite {
  return {
    token: r.token, ownerUserId: r.owner_user_id, email: r.email, role: r.role,
    allocated: r.allocated, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
    acceptedBy: r.accepted_by, acceptedAt: r.accepted_at,
  };
}

/** GET → 主账号的邀请列表 (带有效状态: 过期的 pending 显示 expired). */
export async function GET(request: NextRequest) {
  const owner = await ownerId(request);
  const rows = await getDbDriver().query<any>('SELECT * FROM team_invites WHERE owner_user_id = ? ORDER BY created_at DESC', [owner]);
  const nowIso = new Date().toISOString();
  const invites = rows.map(rowToInvite).map((inv) => ({ ...inv, status: effectiveInviteStatus(inv, nowIso) }));
  return NextResponse.json({ invites });
}

/** POST { email, role, allocated } → 生成邀请 token + 接受链接 (仅主账号). */
export async function POST(request: NextRequest) {
  const owner = await ownerId(request);
  const body = await request.json().catch(() => ({} as any));
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const role = isAssignableRole(body?.role) ? body.role : 'member';
  if (!email) return NextResponse.json({ message: 'email 必填' }, { status: 400 });

  const { pool, members } = await loadTeam(owner);
  // 邀请额度收敛到当前可分, 防一开始就超池
  const allocated = capAllocationToPool(pool, members, Math.max(0, Math.floor(Number(body?.allocated) || 0)));

  const token = nanoid(16);
  const invite = buildInvite({ token, ownerUserId: owner, email, role, allocated, nowIso: new Date().toISOString() });
  await getDbDriver().run(
    `INSERT INTO team_invites (token, owner_user_id, email, role, allocated, status, created_at, expires_at, accepted_by, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [invite.token, invite.ownerUserId, invite.email, invite.role, invite.allocated, invite.status, invite.createdAt, invite.expiresAt],
  );

  return NextResponse.json({ ok: true, invite, link: `/dashboard/team/accept?token=${token}` });
}
