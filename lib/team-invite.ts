/**
 * v6.5.1 — 真·多用户成员邀请 · 纯逻辑 (client-safe, 可单测)
 *
 * 主账号生成一条带 token 的邀请 (邮箱 + 角色 + 额度) → 被邀请的"已有账号"用户用链接接受 →
 * 以其真实 user id 进团队成员表. 这里只做 token 之外的纯逻辑 (校验/过期/记录构建/落成员);
 * token 生成 (nanoid) + 落库 + 当前登录用户解析在 API 层. **不创建账号** — 接受者须已登录.
 */

import type { TeamRole, MemberAllocation } from './team-credits';

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface TeamInvite {
  token: string;
  ownerUserId: string;
  email: string;
  role: TeamRole;
  allocated: number;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  acceptedBy?: string | null;
  acceptedAt?: string | null;
}

export const INVITE_TTL_DAYS = 7;

/** 可被邀请的角色 (owner 不能被邀请). */
export function isAssignableRole(role: unknown): role is Exclude<TeamRole, 'owner'> {
  return role === 'member' || role === 'admin';
}

export function normalizeInviteEmail(s: unknown): string {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

/** ISO now 是否已过邀请有效期. */
export function isInviteExpired(inv: Pick<TeamInvite, 'expiresAt'>, nowIso: string): boolean {
  return nowIso > inv.expiresAt;
}

/** 邀请的"有效状态": pending 且已过期 → expired (落库状态可能还是 pending). */
export function effectiveInviteStatus(inv: TeamInvite, nowIso: string): InviteStatus {
  if (inv.status === 'pending' && isInviteExpired(inv, nowIso)) return 'expired';
  return inv.status;
}

export interface AcceptCheck { ok: boolean; reason?: string }

/** 能否接受: 必须 pending 且未过期. */
export function canAcceptInvite(inv: TeamInvite, nowIso: string): AcceptCheck {
  if (inv.status === 'accepted') return { ok: false, reason: '邀请已被接受' };
  if (inv.status === 'revoked') return { ok: false, reason: '邀请已撤销' };
  if (isInviteExpired(inv, nowIso)) return { ok: false, reason: '邀请已过期' };
  return { ok: true };
}

function addDaysIso(nowIso: string, days: number): string {
  const t = new Date(nowIso).getTime();
  return new Date(t + days * 86400_000).toISOString();
}

/** 构建一条 pending 邀请记录 (token 由调用方给). */
export function buildInvite(opts: {
  token: string;
  ownerUserId: string;
  email: string;
  role: TeamRole;
  allocated: number;
  nowIso: string;
  ttlDays?: number;
}): TeamInvite {
  return {
    token: opts.token,
    ownerUserId: opts.ownerUserId,
    email: normalizeInviteEmail(opts.email),
    role: isAssignableRole(opts.role) ? opts.role : 'member',
    allocated: Math.max(0, Math.floor(opts.allocated || 0)),
    status: 'pending',
    createdAt: opts.nowIso,
    expiresAt: addDaysIso(opts.nowIso, opts.ttlDays ?? INVITE_TTL_DAYS),
    acceptedBy: null,
    acceptedAt: null,
  };
}

/** 由邀请 + 接受者真实账号生成团队成员记录 (用 allocated 覆写可传入, 防超池). */
export function memberFromInvite(
  inv: TeamInvite,
  user: { id: string; name?: string; email?: string },
  allocatedOverride?: number,
): MemberAllocation {
  return {
    id: user.id,
    name: user.name || user.email || inv.email,
    role: inv.role,
    allocated: Math.max(0, Math.floor(allocatedOverride ?? inv.allocated)),
    used: 0,
  };
}
