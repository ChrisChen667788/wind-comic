import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.4.3 — httpOnly 会话验收:
 *   1. 仅注入 cookie(无 localStorage / 无 Bearer)→ /api/auth/me 200(SSE 同源能力)
 *   2. 「删除 localStorage token 后会话仍在」—— 注入双轨后清 localStorage,
 *      页面内 fetch(不带 Bearer)仍 200
 *   3. logout API 下发 Max-Age=0 清除头
 * 会话一律 mint(读 demo 用户 + jwt.sign),不走密码登录。
 */

function mintToken(): string {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as { id: string; role: string };
  db.close();
  return jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' });
}

test('仅 cookie(无 Bearer/localStorage)即可通过鉴权', async ({ browser }) => {
  const token = mintToken();
  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  await context.addCookies([{
    name: 'qfmj-session', value: encodeURIComponent(token),
    domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax',
  }]);
  const res = await context.request.get('/api/auth/me'); // 不带 Authorization
  expect(res.status(), 'cookie 单独应通过 /api/auth/me').toBe(200);
  const me = await res.json();
  expect(me.email).toBe('demo@qfmanju.ai');
  await context.close();
});

test('删除 localStorage token 后会话仍在(cookie 兜底)', async ({ browser }) => {
  const token = mintToken();
  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  await context.addCookies([{
    name: 'qfmj-session', value: encodeURIComponent(token),
    domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax',
  }]);
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // 模拟 XSS 清掉/偷不到 localStorage 的场景:页面里没有任何 token
  const status = await page.evaluate(async () => {
    localStorage.removeItem('qfmj-token');
    localStorage.removeItem('qfmj-user');
    const r = await fetch('/api/auth/me'); // 浏览器自动携带 httpOnly cookie
    return r.status;
  });
  expect(status, '无 localStorage、无 Bearer,cookie 仍应维持会话').toBe(200);
  await context.close();
});

test('logout 下发 Max-Age=0 清除头', async ({ request }) => {
  const res = await request.post('/api/auth/logout');
  expect(res.status()).toBe(200);
  const setCookie = res.headers()['set-cookie'] || '';
  expect(setCookie).toContain('qfmj-session=;');
  expect(setCookie).toContain('Max-Age=0');
  expect(setCookie).toContain('HttpOnly');
});
