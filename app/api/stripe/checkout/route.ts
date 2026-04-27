/**
 * POST /api/stripe/checkout · Sprint C.2
 *
 * 用户在 /dashboard/billing 点"升级到 Pro" → 前端 POST 这个 → 拿到 Stripe Checkout URL
 * → location.href 跳过去 → 用户在 Stripe 完成支付 → Stripe 跳回 /dashboard/billing?status=success
 * → 同时 Stripe 触发 webhook → /api/stripe/webhook 把 user.subscription_tier 升好
 *
 * 入参: { tier: 'creator' | 'pro' | 'enterprise' }
 * 出参:
 *   200 → { url, sessionId }
 *   400 → { error } — 缺 tier / tier 非法 / free 档不需要付费
 *   401 → { error } — 未登录
 *   422 → { error } — Stripe 未配置 (env 缺)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import {
  createCheckoutSession,
  STRIPE_TIERS,
  StripeNotConfiguredError,
  type StripeTier,
} from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  const userId = payload?.sub;
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const tier = body?.tier;
  if (!tier) return NextResponse.json({ error: '缺 tier' }, { status: 400 });
  if (!STRIPE_TIERS.includes(tier)) {
    return NextResponse.json(
      { error: `tier 必须是 ${STRIPE_TIERS.join(' / ')} 之一` },
      { status: 400 },
    );
  }

  const user = db
    .prepare('SELECT id, email, stripe_customer_id FROM users WHERE id = ?')
    .get(userId) as { id: string; email: string; stripe_customer_id?: string } | undefined;
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

  try {
    const result = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      tier: tier as StripeTier,
      stripeCustomerId: user.stripe_customer_id || undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.error('[Stripe checkout] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'checkout 失败' },
      { status: 500 },
    );
  }
}
