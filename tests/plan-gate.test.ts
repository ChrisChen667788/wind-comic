/**
 * Sprint C.2 — plan-gate 单测
 *
 * 锁住 tier 排序 + checkPlan 决策 + planRejection 响应格式.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 必须在 import plan-gate 之前 mock db / auth lib
vi.mock('@/lib/db', () => ({
  db: { prepare: vi.fn() },
  now: () => new Date().toISOString(),
}));
vi.mock('@/app/api/auth/lib', () => ({
  getUserFromRequest: vi.fn(),
}));

import { tierRank, checkPlan, planRejection, TIER_ORDER } from '@/lib/plan-gate';
import { db } from '@/lib/db';
import { getUserFromRequest } from '@/app/api/auth/lib';

const mockDbPrepare = (db.prepare as unknown as ReturnType<typeof vi.fn>);
const mockGetUser = getUserFromRequest as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockDbPrepare.mockReset();
  mockGetUser.mockReset();
});

const mkReq = () => new Request('http://localhost/x') as any;

describe('tierRank', () => {
  it('orders free < creator < pro < enterprise', () => {
    expect(tierRank('free')).toBeLessThan(tierRank('creator'));
    expect(tierRank('creator')).toBeLessThan(tierRank('pro'));
    expect(tierRank('pro')).toBeLessThan(tierRank('enterprise'));
  });

  it('treats null/undefined/unknown as free (rank 0)', () => {
    expect(tierRank(null)).toBe(0);
    expect(tierRank(undefined)).toBe(0);
    expect(tierRank('unknown-tier')).toBe(0);
  });

  it('TIER_ORDER constant is the canonical ordering', () => {
    expect(TIER_ORDER).toEqual(['free', 'creator', 'pro', 'enterprise']);
  });
});

describe('checkPlan', () => {
  it('unauthenticated user → current=free, ok only for free routes', () => {
    mockGetUser.mockReturnValue(null);
    const free = checkPlan(mkReq(), 'free');
    expect(free).toEqual({ ok: true, current: 'free', required: 'free', userId: null });
    const pro = checkPlan(mkReq(), 'pro');
    expect(pro.ok).toBe(false);
    expect(pro.userId).toBeNull();
  });

  it('user without subscription_tier in DB → defaults to free', () => {
    mockGetUser.mockReturnValue({ sub: 'user-X' });
    mockDbPrepare.mockReturnValue({ get: () => undefined } as any);
    const r = checkPlan(mkReq(), 'pro');
    expect(r.current).toBe('free');
    expect(r.ok).toBe(false);
  });

  it('pro user → can use pro features and below', () => {
    mockGetUser.mockReturnValue({ sub: 'user-pro' });
    mockDbPrepare.mockReturnValue({ get: () => ({ subscription_tier: 'pro' }) } as any);
    expect(checkPlan(mkReq(), 'free').ok).toBe(true);
    expect(checkPlan(mkReq(), 'creator').ok).toBe(true);
    expect(checkPlan(mkReq(), 'pro').ok).toBe(true);
    expect(checkPlan(mkReq(), 'enterprise').ok).toBe(false);
  });

  it('enterprise user → can use everything', () => {
    mockGetUser.mockReturnValue({ sub: 'user-ent' });
    mockDbPrepare.mockReturnValue({ get: () => ({ subscription_tier: 'enterprise' }) } as any);
    for (const t of ['free', 'creator', 'pro', 'enterprise'] as const) {
      expect(checkPlan(mkReq(), t).ok).toBe(true);
    }
  });
});

describe('planRejection', () => {
  it('returns 402 Payment Required with structured body', async () => {
    const res = planRejection('free', 'pro');
    expect(res.status).toBe(402);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('plan_required');
    expect(body.current).toBe('free');
    expect(body.required).toBe('pro');
    expect(body.upgradeUrl).toBe('/dashboard/billing');
  });
});

describe('PLAN_GATE_DISABLED 总开关(上线前/本地测试放行所有 gate)', () => {
  it('=1 → free 用户也通过 enterprise gate(ok=true,current 仍如实)', () => {
    const prev = process.env.PLAN_GATE_DISABLED;
    process.env.PLAN_GATE_DISABLED = '1';
    try {
      mockGetUser.mockReturnValue(null); // 未登录 = free
      const r = checkPlan(mkReq(), 'enterprise');
      expect(r.ok).toBe(true);          // 放行
      expect(r.current).toBe('free');   // 不撒谎,如实报当前档
      expect(r.required).toBe('enterprise');
    } finally {
      if (prev === undefined) delete process.env.PLAN_GATE_DISABLED; else process.env.PLAN_GATE_DISABLED = prev;
    }
  });

  it('未设(默认)→ 照常拦截(free < pro)', () => {
    delete process.env.PLAN_GATE_DISABLED;
    mockGetUser.mockReturnValue(null);
    expect(checkPlan(mkReq(), 'pro').ok).toBe(false);
  });
});
