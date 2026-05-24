/**
 * v6.5.1 — 成员消费扣减 + 真·多用户邀请 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  consume, costOf, capAllocationToPool, GENERATION_COST, remaining,
  type MemberAllocation,
} from '@/lib/team-credits';
import {
  isAssignableRole, normalizeInviteEmail, isInviteExpired, effectiveInviteStatus,
  canAcceptInvite, buildInvite, memberFromInvite, INVITE_TTL_DAYS, type TeamInvite,
} from '@/lib/team-invite';

const members: MemberAllocation[] = [
  { id: 'u-a', role: 'member', allocated: 300, used: 280 }, // 剩 20
  { id: 'u-b', role: 'member', allocated: 200, used: 0 },   // 剩 200
];

describe('v6.5.1 · consume 消费扣减', () => {
  it('剩余够 → 计入 used (不可变)', () => {
    const r = consume(members, 'u-b', 50);
    expect(r.ok).toBe(true);
    expect(r.member!.used).toBe(50);
    expect(remaining(r.member!)).toBe(150);
    expect(members[1].used).toBe(0); // 原数组不变
  });
  it('余额不足 → 拒绝', () => {
    const r = consume(members, 'u-a', 21); // 剩 20
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('额度不足');
  });
  it('恰好用满 → 允许', () => {
    expect(consume(members, 'u-a', 20).ok).toBe(true);
  });
  it('负数 / 不存在成员 → 拒绝', () => {
    expect(consume(members, 'u-a', -1).ok).toBe(false);
    expect(consume(members, 'nope', 1).ok).toBe(false);
  });
});

describe('v6.5.1 · costOf 生成成本', () => {
  it('已知类型按表', () => {
    expect(costOf('image')).toBe(GENERATION_COST.image);
    expect(costOf('video')).toBe(5);
  });
  it('按份数乘 + 向上取整', () => {
    expect(costOf('image', 3)).toBe(3);
    expect(costOf('video', 2)).toBe(10);
  });
  it('未知类型按 1/份, 负数归零', () => {
    expect(costOf('mystery')).toBe(1);
    expect(costOf('image', -5)).toBe(0);
  });
});

describe('v6.5.1 · capAllocationToPool', () => {
  it('收敛到剩余可分', () => {
    // pool 1000, 已分 500 → 可分 500
    expect(capAllocationToPool(1000, members, 800)).toBe(500);
    expect(capAllocationToPool(1000, members, 300)).toBe(300);
  });
  it('池满 → 0; 负数 desired → 0', () => {
    expect(capAllocationToPool(500, members, 100)).toBe(0);
    expect(capAllocationToPool(1000, members, -10)).toBe(0);
  });
});

describe('v6.5.1 · 邀请纯逻辑', () => {
  const NOW = '2026-05-24T00:00:00.000Z';

  it('isAssignableRole: member/admin 可, owner/乱值 否', () => {
    expect(isAssignableRole('member')).toBe(true);
    expect(isAssignableRole('admin')).toBe(true);
    expect(isAssignableRole('owner')).toBe(false);
    expect(isAssignableRole('x')).toBe(false);
  });
  it('normalizeInviteEmail: trim + 小写', () => {
    expect(normalizeInviteEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeInviteEmail(123)).toBe('');
  });

  it('buildInvite: 角色矫正 + allocated floor + 7 天过期', () => {
    const inv = buildInvite({ token: 't1', ownerUserId: 'owner', email: 'A@B.com', role: 'owner' as any, allocated: 50.9, nowIso: NOW });
    expect(inv.role).toBe('member'); // owner 不可邀 → 回落 member
    expect(inv.allocated).toBe(50);
    expect(inv.status).toBe('pending');
    expect(inv.email).toBe('a@b.com');
    const days = (new Date(inv.expiresAt).getTime() - new Date(NOW).getTime()) / 86400_000;
    expect(Math.round(days)).toBe(INVITE_TTL_DAYS);
  });

  it('过期判定 + effectiveInviteStatus', () => {
    const inv = buildInvite({ token: 't', ownerUserId: 'o', email: 'a@b.com', role: 'member', allocated: 0, nowIso: NOW });
    expect(isInviteExpired(inv, NOW)).toBe(false);
    const later = '2026-06-24T00:00:00.000Z';
    expect(isInviteExpired(inv, later)).toBe(true);
    expect(effectiveInviteStatus(inv, later)).toBe('expired'); // 落库还是 pending, 有效状态 expired
    expect(effectiveInviteStatus({ ...inv, status: 'accepted' }, later)).toBe('accepted');
  });

  it('canAcceptInvite: pending+未过期可; accepted/revoked/过期 否', () => {
    const inv = buildInvite({ token: 't', ownerUserId: 'o', email: 'a@b.com', role: 'admin', allocated: 100, nowIso: NOW });
    expect(canAcceptInvite(inv, NOW).ok).toBe(true);
    expect(canAcceptInvite({ ...inv, status: 'accepted' }, NOW).ok).toBe(false);
    expect(canAcceptInvite({ ...inv, status: 'revoked' }, NOW).ok).toBe(false);
    expect(canAcceptInvite(inv, '2026-07-01T00:00:00.000Z').ok).toBe(false);
  });

  it('memberFromInvite: 用接受者真实 id + 角色/额度来自邀请, used=0', () => {
    const inv: TeamInvite = buildInvite({ token: 't', ownerUserId: 'o', email: 'a@b.com', role: 'admin', allocated: 120, nowIso: NOW });
    const m = memberFromInvite(inv, { id: 'real-uid', name: '小明', email: 'x@y.com' });
    expect(m).toEqual({ id: 'real-uid', name: '小明', role: 'admin', allocated: 120, used: 0 });
    // allocatedOverride 防超池
    expect(memberFromInvite(inv, { id: 'real-uid' }, 50).allocated).toBe(50);
  });
});
