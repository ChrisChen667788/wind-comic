/**
 * v6.5 — 团队工作区 · 积分额度分配 + RBAC (纯逻辑, client-safe, 可单测)
 *
 * 对标 火山剧创「主账号按成员/团队分配积分额度」. 这里做额度分配的校验/汇总数学
 * + 角色权限判定. DB 持久化 + API + UI 复用本核心.
 */

export type TeamRole = 'owner' | 'admin' | 'member';

export interface MemberAllocation {
  /** 成员标识 (user id 或 email) */
  id: string;
  name?: string;
  role: TeamRole;
  /** 分配到的积分额度 */
  allocated: number;
  /** 已消耗 */
  used: number;
}

/** 成员剩余可用. */
export function remaining(m: MemberAllocation): number {
  return Math.max(0, m.allocated - m.used);
}

export function totalAllocated(members: MemberAllocation[]): number {
  return members.reduce((s, m) => s + Math.max(0, m.allocated), 0);
}

export function totalUsed(members: MemberAllocation[]): number {
  return members.reduce((s, m) => s + Math.max(0, m.used), 0);
}

export interface PoolSummary {
  pool: number;
  allocated: number;
  unallocated: number;
  used: number;
  overAllocated: boolean;
}

/** 团队池总览. */
export function poolSummary(pool: number, members: MemberAllocation[]): PoolSummary {
  const allocated = totalAllocated(members);
  const used = totalUsed(members);
  return { pool, allocated, unallocated: pool - allocated, used, overAllocated: allocated > pool };
}

export interface AllocCheck { ok: boolean; reason?: string }

/** 能否把某成员额度设为 amount (其余成员不变, 不超总池, 不低于其已用). */
export function canSetAllocation(
  pool: number,
  members: MemberAllocation[],
  memberId: string,
  amount: number,
): AllocCheck {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: '额度需为非负数' };
  const others = members
    .filter((m) => m.id !== memberId)
    .reduce((s, m) => s + Math.max(0, m.allocated), 0);
  if (others + amount > pool) return { ok: false, reason: `超出团队总额度(剩余可分 ${pool - others})` };
  const m = members.find((x) => x.id === memberId);
  if (m && amount < m.used) return { ok: false, reason: `不能低于已用额度 ${m.used}` };
  return { ok: true };
}

/** 不可变地设置某成员额度 (调用方应先 canSetAllocation 校验). */
export function setAllocation(members: MemberAllocation[], memberId: string, amount: number): MemberAllocation[] {
  return members.map((m) => (m.id === memberId ? { ...m, allocated: Math.max(0, amount) } : m));
}

/** 成员能否消费 cost (剩余够). */
export function canConsume(m: MemberAllocation, cost: number): boolean {
  return cost >= 0 && remaining(m) >= cost;
}

// ── RBAC ──────────────────────────────────────────────────────────────
export function canManageMembers(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** 仅 owner 能分配/改额度. */
export function canAllocateCredits(role: TeamRole): boolean {
  return role === 'owner';
}

/** actor 能否移除 target: owner/admin 可移除, 但 owner 不可被移除. */
export function canRemoveMember(actorRole: TeamRole, targetRole: TeamRole): boolean {
  if (targetRole === 'owner') return false;
  return canManageMembers(actorRole);
}
