import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, clientIp, _resetRateLimits } from '@/lib/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => _resetRateLimits());

  it('放行直到达上限,之后拒绝', () => {
    const opts = { limit: 3, windowMs: 1000 };
    const t = 1000;
    expect(rateLimit('k', opts, t)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rateLimit('k', opts, t)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateLimit('k', opts, t)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = rateLimit('k', opts, t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('窗口过期后重置', () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit('k', opts, 0).allowed).toBe(true);
    expect(rateLimit('k', opts, 500).allowed).toBe(false); // 窗口内、已满
    expect(rateLimit('k', opts, 1000).allowed).toBe(true); // 到点重置
  });

  it('不同 key 互不影响', () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit('a', opts, 0).allowed).toBe(true);
    expect(rateLimit('b', opts, 0).allowed).toBe(true);
    expect(rateLimit('a', opts, 0).allowed).toBe(false);
  });

  it('retryAfterSec 反映剩余窗口', () => {
    const opts = { limit: 1, windowMs: 10_000 };
    rateLimit('k', opts, 0);
    const r = rateLimit('k', opts, 3000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(7); // ceil((10000-3000)/1000)
  });
});

describe('clientIp', () => {
  it('取 x-forwarded-for 首段', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
  it('降级 x-real-ip', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });
  it('都没有 → unknown', () => {
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
