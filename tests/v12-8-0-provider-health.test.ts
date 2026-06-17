/**
 * v12.8.0 — provider 软熔断缓存(TTL 冷却 + 致命错误判定 + 自动恢复)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  markProviderDown, isProviderHealthy, markProviderDownIfFatal,
  markProviderHealthy, clearProviderHealth, listUnhealthy,
} from '@/lib/provider-health-cache';

describe('v12.8.0 · provider-health-cache', () => {
  beforeEach(() => { clearProviderHealth(); vi.useRealTimers(); });
  afterEach(() => vi.useRealTimers());

  it('未标记 = 健康', () => {
    expect(isProviderHealthy('veo')).toBe(true);
  });

  it('markProviderDown → 不健康;TTL 过期自动恢复', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-16T00:00:00Z'));
    markProviderDown('veo', 60_000);
    expect(isProviderHealthy('veo')).toBe(false);
    vi.setSystemTime(new Date('2026-06-16T00:00:59Z'));
    expect(isProviderHealthy('veo')).toBe(false);   // 未到点
    vi.setSystemTime(new Date('2026-06-16T00:01:01Z'));
    expect(isProviderHealthy('veo')).toBe(true);    // 过 TTL 自动恢复
  });

  it('TTL 夹到 ≥60s(防高并发震荡)', () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    markProviderDown('x', 1000); // 请求 1s → 实际夹到 60s
    vi.setSystemTime(30_000);
    expect(isProviderHealthy('x')).toBe(false);
  });

  it('markProviderDownIfFatal:auth/配额/饱和/限流熔断,超时/未知不熔断', () => {
    expect(markProviderDownIfFatal('a', 'HTTP 401 Unauthorized')).toBe(true);
    expect(isProviderHealthy('a')).toBe(false);
    expect(markProviderDownIfFatal('b', '余额不足')).toBe(true);
    expect(markProviderDownIfFatal('c', 'pre_consume_token_quota_failed 分组饱和')).toBe(true);
    expect(markProviderDownIfFatal('d', 'rate limit 429')).toBe(true);
    // 不该熔断:瞬时/未知
    expect(markProviderDownIfFatal('e', 'ETIMEDOUT request timeout')).toBe(false);
    expect(isProviderHealthy('e')).toBe(true);
    expect(markProviderDownIfFatal('f', 'some random unexpected error')).toBe(false);
  });

  it('markProviderHealthy 显式恢复 + listUnhealthy 反映冷却中', () => {
    markProviderDown('z', 120_000);
    expect(listUnhealthy().some((u) => u.id === 'z')).toBe(true);
    markProviderHealthy('z');
    expect(isProviderHealthy('z')).toBe(true);
    expect(listUnhealthy().some((u) => u.id === 'z')).toBe(false);
  });
});
