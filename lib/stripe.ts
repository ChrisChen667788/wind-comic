/**
 * lib/stripe — Stripe 4 档订阅集成 (Sprint C.2)
 *
 * 三件事:
 *   1. createCheckoutSession()       — 把用户重定向到 Stripe Checkout 页
 *   2. verifyWebhookEvent()          — webhook 入口校验签名 + 反序列化事件
 *   3. mapTierToPriceId()            — 4 档 tier → Stripe Price ID 映射 (env-driven)
 *
 * env 配置(全部用 STRIPE_ 前缀, 与 OPENAI_ / MINIMAX_ 风格一致):
 *   STRIPE_SECRET_KEY            必填 — sk_test_ / sk_live_
 *   STRIPE_WEBHOOK_SECRET        必填 — whsec_xxx (Webhook Signing Secret)
 *   STRIPE_PRICE_ID_CREATOR      创作版 月度价 ID (price_xxx)
 *   STRIPE_PRICE_ID_PRO          专业版 月度价 ID
 *   STRIPE_PRICE_ID_ENTERPRISE   企业版 月度价 ID (-1 价格,但 Stripe 还是要 price)
 *   NEXT_PUBLIC_APP_URL          回调 URL 域 (https://wind-comic.com / http://localhost:3000)
 *
 * Free 档不上 Stripe — 默认值, 不需要订阅。
 *
 * 不做的事:
 *   · 不直接读写 users 表 (那是 webhook 路由的职责, 这里只做 SDK 包装)
 *   · 不缓存 Stripe 客户端 (next dev 环境 hot-reload 友好, prod 也每 req 一个 client 影响小)
 */

import Stripe from 'stripe';

export const STRIPE_TIERS = ['creator', 'pro', 'enterprise'] as const;
export type StripeTier = (typeof STRIPE_TIERS)[number];

export type AnyTier = 'free' | StripeTier;

/** Stripe webhook 会推这些 event types — 我们只关心订阅生命周期相关的几个 */
export const HANDLED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export class StripeNotConfiguredError extends Error {
  constructor(field: string) {
    super(`Stripe 未配置: 缺 env ${field}`);
    this.name = 'StripeNotConfiguredError';
  }
}

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError('STRIPE_SECRET_KEY');
  // 不指定 apiVersion → 让 SDK 自己选最新 default,跟着 stripe@22.x 升级
  return new Stripe(key);
}

/** tier → Stripe Price ID. enterprise 是定制价, 这里仍允许返回 env 配置的占位 price */
export function mapTierToPriceId(tier: StripeTier): string {
  const map: Record<StripeTier, string | undefined> = {
    creator: process.env.STRIPE_PRICE_ID_CREATOR,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    enterprise: process.env.STRIPE_PRICE_ID_ENTERPRISE,
  };
  const id = map[tier];
  if (!id) throw new StripeNotConfiguredError(`STRIPE_PRICE_ID_${tier.toUpperCase()}`);
  return id;
}

export interface CheckoutInput {
  userId: string;
  email: string;
  tier: StripeTier;
  /** 已存在的 Stripe Customer ID, 没有就传 undefined 让 Stripe 用 email 自动找/建 */
  stripeCustomerId?: string;
  /** 成功 / 取消 时回调 URL — 一般是 /dashboard/billing?status=success / ?status=canceled */
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

/** 用户点"升级到 Pro" → 后端调本函数 → 返回 url, 前端 location.href = url */
export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutResult> {
  const stripe = getStripeClient();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: mapTierToPriceId(input.tier), quantity: 1 }],
    customer: input.stripeCustomerId,
    customer_email: input.stripeCustomerId ? undefined : input.email,
    client_reference_id: input.userId,
    // 把 tier 也带在 metadata 里 — webhook 拿到 session 反查 metadata 知道用户买的是哪档
    metadata: {
      userId: input.userId,
      tier: input.tier,
    },
    subscription_data: {
      metadata: {
        userId: input.userId,
        tier: input.tier,
      },
    },
    success_url:
      input.successUrl ||
      `${baseUrl}/dashboard/billing?status=success&tier=${encodeURIComponent(input.tier)}`,
    cancel_url:
      input.cancelUrl || `${baseUrl}/dashboard/billing?status=canceled`,
  });
  if (!session.url) {
    throw new Error('Stripe checkout session 没返回 URL — 检查 Stripe Dashboard 是否启用了 Checkout');
  }
  return { sessionId: session.id, url: session.url };
}

/** webhook 入口校验. 失败抛错 → 路由统一返回 400 */
export function verifyWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeNotConfiguredError('STRIPE_WEBHOOK_SECRET');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * webhook 处理 — 把 Stripe 事件解析成"用户 X 的 tier 应该变 Y, status 是 Z, customer ID 是 C"。
 * 路由层拿这个结果直接 UPDATE users。
 *
 * 解耦设计: 本函数纯函数, 不打 DB, 给单测直接喂 mock event 跑过。
 */
export interface SubscriptionStateChange {
  userId: string;
  tier: AnyTier;
  status: string | null;
  stripeCustomerId: string | null;
}

export function deriveSubscriptionChange(event: Stripe.Event): SubscriptionStateChange | null {
  const type = event.type as (typeof HANDLED_WEBHOOK_EVENTS)[number];

  if (type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = (session.metadata?.userId || session.client_reference_id) as string | undefined;
    const tier = session.metadata?.tier as AnyTier | undefined;
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
    if (!userId || !tier) return null;
    return {
      userId,
      tier,
      status: 'active',
      stripeCustomerId: customerId,
    };
  }

  if (type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.userId;
    const tier = (sub.metadata?.tier as AnyTier | undefined) || undefined;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if (!userId) return null;
    return {
      userId,
      tier: tier || 'free', // metadata 缺则保守降级
      status: sub.status,
      stripeCustomerId: customerId,
    };
  }

  if (type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.userId;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if (!userId) return null;
    return {
      userId,
      tier: 'free',                // 取消 = 降回免费
      status: 'canceled',
      stripeCustomerId: customerId,
    };
  }

  return null; // 其他事件类型不动
}
