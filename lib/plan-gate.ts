/**
 * lib/plan-gate — 订阅档位 gate (Sprint C.2)
 *
 * 给受 plan 限制的 API 路由用. 例如:
 *   const { ok, current, required } = await checkPlan(req, 'pro');
 *   if (!ok) return planRejection(current, required);
 *
 * 决策:
 *   tier 排序 free < creator < pro < enterprise (4 档线性)
 *   未登录用户 → 当作 free 算 (不直接 401, 让上层路由自己决定要不要 401)
 *   tier 为 null/missing → 也当 free
 *
 * 不做的事:
 *   · 不查 Stripe 上游 — 本地 DB users.subscription_tier 是真源 (webhook 已经把它写对了)
 *   · 不做 status 检查 — past_due / incomplete 也允许使用, status 由账户页面提示用户去 Stripe Portal 处理
 */

import { db } from './db';
import { getUserFromRequest } from '@/app/api/auth/lib';
import type { AnyTier } from './stripe';

export const TIER_ORDER: AnyTier[] = ['free', 'creator', 'pro', 'enterprise'];

export function tierRank(tier: string | null | undefined): number {
  const idx = TIER_ORDER.indexOf((tier as AnyTier) || 'free');
  return idx === -1 ? 0 : idx;
}

export interface PlanCheck {
  ok: boolean;
  current: AnyTier;
  required: AnyTier;
  userId: string | null;
}

/**
 * 给定一个请求,返回该用户当前 tier 能不能消费 minTier 及以上的功能.
 * 没登录 → current=free, ok 由 minTier 判断 (free 路由仍然 ok)
 */
export function checkPlan(request: Request, minTier: AnyTier): PlanCheck {
  const payload = getUserFromRequest(request);
  const userId = payload?.sub || null;
  let current: AnyTier = 'free';
  if (userId) {
    const row = db
      .prepare('SELECT subscription_tier FROM users WHERE id = ?')
      .get(userId) as { subscription_tier?: string } | undefined;
    current = (row?.subscription_tier as AnyTier) || 'free';
  }
  return {
    ok: tierRank(current) >= tierRank(minTier),
    current,
    required: minTier,
    userId,
  };
}

/** 标准化拒绝响应 — 路由直接 return 这个 */
export function planRejection(current: AnyTier, required: AnyTier): Response {
  return new Response(
    JSON.stringify({
      error: 'plan_required',
      message: `本功能需要 ${required} 档及以上, 你当前是 ${current}`,
      current,
      required,
      upgradeUrl: '/dashboard/billing',
    }),
    {
      status: 402, // Payment Required
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
