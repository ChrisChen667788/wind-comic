/**
 * POST /api/stripe/webhook · Sprint C.2
 *
 * Stripe 在订阅生命周期事件发生时打这个 endpoint, 我们用 webhook signing secret 校验签名,
 * 然后把 (userId, tier, status, stripe_customer_id) 写回 users 表. 这是 plan 变更的真源.
 *
 * Stripe 控制台需要把这个 URL 添加为 webhook endpoint:
 *   https://your-domain.com/api/stripe/webhook
 * 订阅事件:
 *   - checkout.session.completed       (首次付费成功)
 *   - customer.subscription.updated    (升降档/续费/暂停)
 *   - customer.subscription.deleted    (取消订阅)
 *
 * 重要: Stripe 要求 webhook 接收 raw body (不可被 Next 的 JSON parser 提前消费),
 * 所以这里必须读 await request.text() 而不是 .json(), 才能验签通过.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import {
  verifyWebhookEvent,
  deriveSubscriptionChange,
  StripeNotConfiguredError,
} from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: '缺 stripe-signature header' }, { status: 400 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (e) {
    return NextResponse.json(
      { error: 'body 读取失败: ' + (e instanceof Error ? e.message : 'unknown') },
      { status: 400 },
    );
  }

  let event;
  try {
    event = verifyWebhookEvent(rawBody, signature);
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.warn('[Stripe webhook] signature verification failed:', e);
    return NextResponse.json(
      { error: 'signature invalid' },
      { status: 400 },
    );
  }

  const change = deriveSubscriptionChange(event);
  if (!change) {
    // 事件类型不归我们管 — 200 回执让 Stripe 别重试
    return NextResponse.json({ ignored: event.type });
  }

  try {
    const ts = now();
    db.prepare(
      `UPDATE users
        SET subscription_tier = ?,
            subscription_status = ?,
            stripe_customer_id = COALESCE(?, stripe_customer_id),
            updated_at = COALESCE(updated_at, ?)
        WHERE id = ?`,
    ).run(
      change.tier,
      change.status,
      change.stripeCustomerId,
      ts,
      change.userId,
    );
    console.log(
      `[Stripe webhook] user=${change.userId} tier=${change.tier} status=${change.status} type=${event.type}`,
    );
  } catch (e) {
    console.error('[Stripe webhook] DB update failed:', e);
    // 5xx 让 Stripe 重试,这是数据库问题不是请求问题
    return NextResponse.json(
      { error: 'DB update failed: ' + (e instanceof Error ? e.message : 'unknown') },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, type: event.type });
}
