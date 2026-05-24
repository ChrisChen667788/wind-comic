/**
 * v6.5 — 团队积分额度分配 + RBAC 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  remaining, totalAllocated, totalUsed, poolSummary,
  canSetAllocation, setAllocation, canConsume,
  canManageMembers, canAllocateCredits, canRemoveMember,
  type MemberAllocation,
} from '@/lib/team-credits';

const members: MemberAllocation[] = [
  { id: 'u-owner', role: 'owner', allocated: 500, used: 120 },
  { id: 'u-a', role: 'member', allocated: 300, used: 280 },
  { id: 'u-b', role: 'member', allocated: 200, used: 0 },
];

describe('v6.5 · 额度数学', () => {
  it('remaining = allocated - used (不为负)', () => {
    expect(remaining(members[0])).toBe(380);
    expect(remaining({ id: 'x', role: 'member', allocated: 10, used: 50 })).toBe(0);
  });
  it('总额/总用', () => {
    expect(totalAllocated(members)).toBe(1000);
    expect(totalUsed(members)).toBe(400);
  });
  it('poolSummary 计未分配 + 超额标记', () => {
    expect(poolSummary(1200, members)).toEqual({ pool: 1200, allocated: 1000, unallocated: 200, used: 400, overAllocated: false });
    expect(poolSummary(800, members).overAllocated).toBe(true);
  });
});

describe('v6.5 · canSetAllocation', () => {
  it('在池内可设', () => {
    expect(canSetAllocation(1200, members, 'u-b', 400).ok).toBe(true); // others 800 + 400 = 1200 ≤ 1200
  });
  it('超总池拒绝', () => {
    const r = canSetAllocation(1000, members, 'u-b', 400); // others 800 + 400 = 1200 > 1000
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('超出');
  });
  it('低于已用拒绝', () => {
    const r = canSetAllocation(2000, members, 'u-a', 100); // u-a used 280
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('已用');
  });
  it('负数拒绝', () => {
    expect(canSetAllocation(2000, members, 'u-b', -5).ok).toBe(false);
  });
  it('setAllocation 不可变更新', () => {
    const next = setAllocation(members, 'u-b', 250);
    expect(next.find((m) => m.id === 'u-b')!.allocated).toBe(250);
    expect(members.find((m) => m.id === 'u-b')!.allocated).toBe(200); // 原数组不变
  });
});

describe('v6.5 · canConsume', () => {
  it('剩余够才可消费', () => {
    expect(canConsume(members[1], 20)).toBe(true);   // u-a remaining 20
    expect(canConsume(members[1], 21)).toBe(false);
    expect(canConsume(members[1], -1)).toBe(false);
  });
});

describe('v6.5 · RBAC', () => {
  it('管理成员: owner/admin 可, member 否', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageMembers('member')).toBe(false);
  });
  it('分配额度: 仅 owner', () => {
    expect(canAllocateCredits('owner')).toBe(true);
    expect(canAllocateCredits('admin')).toBe(false);
  });
  it('移除成员: owner 不可被移除; owner/admin 可移除普通成员', () => {
    expect(canRemoveMember('owner', 'member')).toBe(true);
    expect(canRemoveMember('admin', 'member')).toBe(true);
    expect(canRemoveMember('admin', 'owner')).toBe(false);
    expect(canRemoveMember('member', 'member')).toBe(false);
  });
});
