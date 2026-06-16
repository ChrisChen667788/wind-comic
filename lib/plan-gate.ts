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
  // 总开关:PLAN_GATE_DISABLED=1 → 所有计费 gate 放行(上线前/本地测试用;真上线删此 env 即恢复)
  const disabled = process.env.PLAN_GATE_DISABLED === '1';
  return {
    ok: disabled || tierRank(current) >= tierRank(minTier),
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

// ════════════════════════════════════════════════════════════════════
// v2.16 P0.1: 视频生成分档 — duration → 最低 tier
//
// 引擎成本档位 (¥/秒):
//   - Minimax I2V-01:    ~¥0.10  (5/6s)
//   - Kling Master:      ~¥0.20  (10s)
//   - Vidu Q3 Pro:       ~¥0.30  (15s)
//
// 定价策略: 只把贵 API 锁后端 tier, 让免费用户至少能跑 5/6s 体验。
// ════════════════════════════════════════════════════════════════════

export type VideoDuration = 5 | 6 | 10 | 15;

/** 视频时长 → 最低 tier 要求 */
export function requiredTierForVideoDuration(duration: VideoDuration | number): AnyTier {
  if (duration <= 6) return 'free';
  if (duration <= 10) return 'creator';
  return 'pro'; // 15s+
}

/** 4K 导出分辨率 → 最低 tier 要求 */
export type ExportResolution = '720p' | '1080p' | '2160p';
export function requiredTierForResolution(res: ExportResolution): AnyTier {
  if (res === '720p') return 'free';
  if (res === '1080p') return 'creator';
  return 'pro'; // 2160p (4K)
}
