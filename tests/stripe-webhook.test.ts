/**
 * Sprint C.2 — Stripe webhook 事件解析单测
 *
 * 锁住 deriveSubscriptionChange 的关键决策(纯函数, 不打 Stripe SDK):
 *   · checkout.session.completed → tier 来自 metadata, status='active', customerId 抓到
 *   · customer.subscription.updated → tier 跟 metadata, status 跟 sub.status (active/past_due/...)
 *   · customer.subscription.deleted → 永远 tier='free' status='canceled' (取消即降回免费)
 *   · 无关事件类型 → 返回 null (路由收到 null 就 200 ignore, Stripe 不会重试)
 *   · metadata 缺 userId → 返回 null (无法路由)
 *   · mapTierToPriceId env 缺 → throws StripeNotConfiguredError
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveSubscriptionChange,
  mapTierToPriceId,
  STRIPE_TIERS,
  HANDLED_WEBHOOK_EVENTS,
  StripeNotConfiguredError,
} from '@/lib/stripe';
import type Stripe from 'stripe';

beforeEach(() => {
  delete process.env.STRIPE_PRICE_ID_CREATOR;
  delete process.env.STRIPE_PRICE_ID_PRO;
  delete process.env.STRIPE_PRICE_ID_ENTERPRISE;
});

const mkEvent = <T extends string>(type: T, object: any): Stripe.Event => ({
  id: 'evt_test',
  api_version: '2025-10-29',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
  type: type as any,
  data: { object },
} as unknown as Stripe.Event);

describe('deriveSubscriptionChange — checkout.session.completed', () => {
  it('extracts userId, tier from metadata + active status + customer id', () => {
    const change = deriveSubscriptionChange(
      mkEvent('checkout.session.completed', {
        customer: 'cus_xyz',
        client_reference_id: 'user-A',
        metadata: { userId: 'user-A', tier: 'pro' },
      }),
    );
    expect(change).toEqual({
      userId: 'user-A',
      tier: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_xyz',
    });
  });

  it('falls back to client_reference_id when metadata.userId missing', () => {
    const change = deriveSubscriptionChange(
      mkEvent('checkout.session.completed', {
        customer: { id: 'cus_obj' },
        client_reference_id: 'user-B',
        metadata: { tier: 'creator' }, // no userId in metadata
      }),
    );
    expect(change?.userId).toBe('user-B');
    expect(change?.stripeCustomerId).toBe('cus_obj'); // unwraps customer object
  });

  it('returns null when neither userId nor client_reference_id present', () => {
    const change = deriveSubscriptionChange(
      mkEvent('checkout.session.completed', {
        customer: 'cus_xyz',
        metadata: { tier: 'pro' },
      }),
    );
    expect(change).toBeNull();
  });

  it('returns null when tier is missing', () => {
    const change = deriveSubscriptionChange(
      mkEvent('checkout.session.completed', {
        customer: 'cus_xyz',
        metadata: { userId: 'user-X' },
      }),
    );
    expect(change).toBeNull();
  });
});

describe('deriveSubscriptionChange — customer.subscription.updated', () => {
  it('uses sub.status as the new status (e.g. past_due)', () => {
    const change = deriveSubscriptionChange(
      mkEvent('customer.subscription.updated', {
        customer: 'cus_q',
        status: 'past_due',
        metadata: { userId: 'user-C', tier: 'pro' },
      }),
    );
    expect(change).toEqual({
      userId: 'user-C',
      tier: 'pro',
      status: 'past_due',
      stripeCustomerId: 'cus_q',
    });
  });

  it('defaults to free when tier missing in metadata (defensive)', () => {
    const change = deriveSubscriptionChange(
      mkEvent('customer.subscription.updated', {
        customer: 'cus_q',
        status: 'active',
        metadata: { userId: 'user-C' },
      }),
    );
    expect(change?.tier).toBe('free');
  });

  it('returns null when metadata.userId missing', () => {
    const change = deriveSubscriptionChange(
      mkEvent('customer.subscription.updated', {
        customer: 'cus_q',
        status: 'active',
        metadata: {},
      }),
    );
    expect(change).toBeNull();
  });
});

describe('deriveSubscriptionChange — customer.subscription.deleted', () => {
  it('always downgrades to free + canceled, regardless of metadata.tier', () => {
    const change = deriveSubscriptionChange(
      mkEvent('customer.subscription.deleted', {
        customer: 'cus_z',
        metadata: { userId: 'user-D', tier: 'enterprise' /* irrelevant */ },
      }),
    );
    expect(change).toEqual({
      userId: 'user-D',
      tier: 'free',
      status: 'canceled',
      stripeCustomerId: 'cus_z',
    });
  });
});

describe('deriveSubscriptionChange — unknown events', () => {
  it('returns null for unrelated event types', () => {
    const change = deriveSubscriptionChange(
      mkEvent('payment_intent.succeeded', { id: 'pi_abc' }),
    );
    expect(change).toBeNull();
  });
});

describe('mapTierToPriceId', () => {
  it('reads price IDs from env per tier', () => {
    process.env.STRIPE_PRICE_ID_CREATOR = 'price_creator';
    process.env.STRIPE_PRICE_ID_PRO = 'price_pro';
    process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_enterprise';
    expect(mapTierToPriceId('creator')).toBe('price_creator');
    expect(mapTierToPriceId('pro')).toBe('price_pro');
    expect(mapTierToPriceId('enterprise')).toBe('price_enterprise');
  });

  it('throws StripeNotConfiguredError with the missing env name when env is unset', () => {
    process.env.STRIPE_PRICE_ID_CREATOR = '';
    expect(() => mapTierToPriceId('creator')).toThrow(StripeNotConfiguredError);
    try {
      mapTierToPriceId('creator');
    } catch (e: any) {
      expect(e.message).toContain('STRIPE_PRICE_ID_CREATOR');
    }
  });
});

describe('design constants', () => {
  it('STRIPE_TIERS = [creator, pro, enterprise] (excludes free)', () => {
    expect(STRIPE_TIERS).toEqual(['creator', 'pro', 'enterprise']);
  });

  it('HANDLED_WEBHOOK_EVENTS covers the 3 subscription-lifecycle events', () => {
    expect(HANDLED_WEBHOOK_EVENTS).toEqual([
      'checkout.session.completed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]);
  });
});
