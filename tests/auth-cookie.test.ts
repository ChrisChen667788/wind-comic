/**
 * v10.4.3 — httpOnly 会话 cookie 单测。
 * 覆盖:cookie 头形状(HttpOnly/SameSite/Max-Age)、清除头、双读顺序
 * (Bearer 优先、cookie 兜底、坏 token 跳过到下一来源)。
 */
import { describe, it, expect } from 'vitest';
import {
  signToken,
  getUserFromRequest,
  sessionCookieHeader,
  clearSessionCookieHeader,
  SESSION_COOKIE,
} from '@/app/api/auth/lib';

const tokenA = signToken({ id: 'user-a', role: 'member' });
const tokenB = signToken({ id: 'user-b', role: 'member' });

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/x', { headers });
}

describe('v10.4.3 · 会话 cookie 头', () => {
  it('下发头:HttpOnly + SameSite=Lax + 7d Max-Age + Path=/', () => {
    const h = sessionCookieHeader(tokenA);
    expect(h).toContain(`${SESSION_COOKIE}=`);
    expect(h).toContain('HttpOnly');
    expect(h).toContain('SameSite=Lax');
    expect(h).toContain(`Max-Age=${7 * 24 * 3600}`);
    expect(h).toContain('Path=/');
    expect(h).not.toContain('Secure'); // 非生产不强制 Secure(本地 http 可用)
  });

  it('清除头:Max-Age=0', () => {
    const h = clearSessionCookieHeader();
    expect(h).toContain(`${SESSION_COOKIE}=;`);
    expect(h).toContain('Max-Age=0');
  });
});

describe('v10.4.3 · getUserFromRequest 双读', () => {
  it('仅 Bearer → 命中', () => {
    expect(getUserFromRequest(req({ authorization: `Bearer ${tokenA}` }))?.sub).toBe('user-a');
  });

  it('仅 cookie → 命中(SSE/无头场景)', () => {
    expect(getUserFromRequest(req({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(tokenA)}` }))?.sub).toBe('user-a');
  });

  it('多 cookie 串中正确提取', () => {
    const cookie = `other=1; ${SESSION_COOKIE}=${encodeURIComponent(tokenA)}; theme=dark`;
    expect(getUserFromRequest(req({ cookie }))?.sub).toBe('user-a');
  });

  it('两者并存 → Bearer 优先(换账号调试时旧 cookie 不抢权)', () => {
    const r = req({
      authorization: `Bearer ${tokenB}`,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(tokenA)}`,
    });
    expect(getUserFromRequest(r)?.sub).toBe('user-b');
  });

  it('坏 Bearer + 好 cookie → 跳到 cookie 兜底', () => {
    const r = req({
      authorization: 'Bearer not-a-jwt',
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(tokenA)}`,
    });
    expect(getUserFromRequest(r)?.sub).toBe('user-a');
  });

  it('两者都没有 / 都坏 → null', () => {
    expect(getUserFromRequest(req({}))).toBeNull();
    expect(getUserFromRequest(req({ cookie: `${SESSION_COOKIE}=junk` }))).toBeNull();
  });
});
