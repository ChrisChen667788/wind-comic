/**
 * v13.5 — 会话 cookie 的 Secure 跟着请求协议走(COOKIE_SECURE=auto|true|false)。
 *
 * 事故:生产模式无条件加 Secure,NAS 用户开 http://<局域网IP>:3100 时浏览器丢弃该 cookie。
 * 登录靠 Bearer 照样成功,但只靠 cookie 的接口(/api/create-stream、/api/projects…)全 401。
 *
 * 两侧都要守:
 *   - 修复侧:生产 + 局域网 HTTP → 不带 Secure,且拿这枚 cookie(不带 Bearer)真能过鉴权;
 *   - 不放水侧:生产 + HTTPS(直连 / 反代 X-Forwarded-Proto / 反代漏转发但浏览器 Origin 是 https)
 *     仍带 Secure;COOKIE_SECURE=true 在 HTTP 下也带 Secure。
 * 路由级用例直接调 route handler(login / logout / me / projects),不起 server。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import {
  sessionCookieHeader,
  clearSessionCookieHeader,
  isHttpsRequest,
  cookieSecureMode,
  signToken,
  _resetCookieSecureWarnings,
  SESSION_COOKIE,
} from '@/app/api/auth/lib';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import { GET as meHandler } from '@/app/api/auth/me/route';
import { GET as projectsHandler } from '@/app/api/projects/route';

const LAN = 'http://192.168.1.10:3100';
const PUBLIC = 'https://wind.example.com';

function req(url: string, headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request(url, { headers, ...init });
}

/** Set-Cookie 的属性集合(小写),便于断言 Secure 有没有。 */
function attrs(setCookie: string): string[] {
  return setCookie.split(';').map((s) => s.trim().toLowerCase());
}
const hasSecure = (h: string) => attrs(h).includes('secure');

beforeEach(() => {
  // 生产模式 + 高强度密钥(生产下弱密钥会 fail-fast)
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('JWT_SECRET', crypto.randomBytes(32).toString('hex'));
  vi.stubEnv('COOKIE_SECURE', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('v13.5 · isHttpsRequest:任一信号说 https 就算', () => {
  it('局域网 HTTP(无代理头、Origin 也是 http)→ 否', () => {
    expect(isHttpsRequest(req(`${LAN}/api/auth/login`))).toBe(false);
    expect(isHttpsRequest(req(`${LAN}/api/auth/login`, { origin: LAN }))).toBe(false);
  });

  it('URL 本身 https → 是', () => {
    expect(isHttpsRequest(req(`${PUBLIC}/api/auth/login`))).toBe(true);
  });

  it('反代转发 X-Forwarded-Proto: https(含多级「https, http」)→ 是', () => {
    expect(isHttpsRequest(req('http://127.0.0.1:3100/api/auth/login', { 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isHttpsRequest(req('http://127.0.0.1:3100/api/auth/login', { 'x-forwarded-proto': 'https, http' }))).toBe(true);
  });

  it('RFC 7239 Forwarded: proto=https → 是;proto=http → 否', () => {
    expect(isHttpsRequest(req('http://127.0.0.1:3100/x', { forwarded: 'for=1.2.3.4;proto=https;host=a' }))).toBe(true);
    expect(isHttpsRequest(req('http://127.0.0.1:3100/x', { forwarded: 'for=1.2.3.4;proto="https"' }))).toBe(true);
    expect(isHttpsRequest(req('http://127.0.0.1:3100/x', { forwarded: 'for=1.2.3.4;proto=http' }))).toBe(false);
  });

  it('反代没转发协议头,但浏览器 Origin 是 https(nginx 默认配置)→ 是', () => {
    expect(isHttpsRequest(req('http://127.0.0.1:3100/api/auth/login', { origin: PUBLIC }))).toBe(true);
  });

  it('同源 GET 不带 Origin,看 Referer:https → 是;http → 否', () => {
    expect(isHttpsRequest(req('http://127.0.0.1:3100/api/auth/me', { referer: `${PUBLIC}/dashboard` }))).toBe(true);
    expect(isHttpsRequest(req(`${LAN}/api/auth/me`, { referer: `${LAN}/dashboard` }))).toBe(false);
  });

  it('所有信号都说 http 才判否 —— X-Forwarded-Proto: http + Origin http', () => {
    expect(isHttpsRequest(req(`${LAN}/x`, { 'x-forwarded-proto': 'http', origin: LAN }))).toBe(false);
  });
});

describe('v13.5 · sessionCookieHeader:生产模式下按请求定 Secure', () => {
  const t = 'tok';

  it('修复侧:auto(默认)+ 局域网 HTTP → 不带 Secure,其余属性不变', () => {
    const h = sessionCookieHeader(t, req(`${LAN}/api/auth/login`, { origin: LAN }));
    expect(hasSecure(h)).toBe(false);
    expect(attrs(h)).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/', `max-age=${7 * 24 * 3600}`]));
  });

  it('不放水侧:auto + HTTPS(直连 / XFP / 仅 Origin)→ 带 Secure', () => {
    expect(hasSecure(sessionCookieHeader(t, req(`${PUBLIC}/api/auth/login`)))).toBe(true);
    expect(hasSecure(sessionCookieHeader(t, req('http://127.0.0.1:3100/x', { 'x-forwarded-proto': 'https' })))).toBe(true);
    expect(hasSecure(sessionCookieHeader(t, req('http://127.0.0.1:3100/x', { origin: PUBLIC })))).toBe(true);
  });

  it('COOKIE_SECURE=true:HTTP 下也带 Secure(钉死,并告警一次说明后果)', () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect(cookieSecureMode()).toBe('true');
    expect(hasSecure(sessionCookieHeader(t, req(`${LAN}/x`)))).toBe(true);
    expect(hasSecure(clearSessionCookieHeader(req(`${LAN}/x`)))).toBe(true);
  });

  it('COOKIE_SECURE=false:HTTPS 下也不带', () => {
    vi.stubEnv('COOKIE_SECURE', 'false');
    expect(hasSecure(sessionCookieHeader(t, req(`${PUBLIC}/x`)))).toBe(false);
  });

  it('大小写/1/0 与未识别值:TRUE→true、0→false、yes→按 auto', () => {
    vi.stubEnv('COOKIE_SECURE', ' TRUE ');
    expect(cookieSecureMode()).toBe('true');
    vi.stubEnv('COOKIE_SECURE', '0');
    expect(cookieSecureMode()).toBe('false');
    vi.stubEnv('COOKIE_SECURE', 'yes');
    expect(cookieSecureMode()).toBe('auto');
    expect(hasSecure(sessionCookieHeader(t, req(`${LAN}/x`)))).toBe(false);
    expect(hasSecure(sessionCookieHeader(t, req(`${PUBLIC}/x`)))).toBe(true);
  });

  it('清除头与下发头同一判定(HTTP 下带 Secure 的清除头会被浏览器整条丢弃)', () => {
    expect(hasSecure(clearSessionCookieHeader(req(`${LAN}/x`)))).toBe(false);
    expect(hasSecure(clearSessionCookieHeader(req(`${PUBLIC}/x`)))).toBe(true);
  });
});

describe('v13.5 · 告警(每进程一次)', () => {
  beforeEach(() => _resetCookieSecureWarnings());

  it('COOKIE_SECURE=true 却收到 HTTP 请求 → 告警说明 cookie 会被丢弃', () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    const warn = vi.mocked(console.warn);
    sessionCookieHeader('tok', req(`${LAN}/x`));
    sessionCookieHeader('tok', req(`${LAN}/x`));
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('COOKIE_SECURE=true'));
    expect(hits).toHaveLength(1);
  });

  it('auto + 生产 + HTTP → 提示一次「公网 HTTPS 请转发 X-Forwarded-Proto」;HTTPS 请求不提示', () => {
    const warn = vi.mocked(console.warn);
    sessionCookieHeader('tok', req(`${PUBLIC}/x`));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('X-Forwarded-Proto'))).toHaveLength(0);
    sessionCookieHeader('tok', req(`${LAN}/x`));
    sessionCookieHeader('tok', req(`${LAN}/x`));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('X-Forwarded-Proto'))).toHaveLength(1);
  });
});

// ── 路由级:真 handler、真库 ──────────────────────────────────────────────────
const EMAIL = 'test-v13-5-lan@test.local';
const PASSWORD = 'lan-pass-' + crypto.randomBytes(4).toString('hex');
const USER_ID = 'test-v13-5-lan-user';

beforeAll(() => {
  db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(USER_ID, EMAIL, bcrypt.hashSync(PASSWORD, 4), 'LAN', 'member', 'zh', new Date().toISOString());
});
afterAll(() => {
  db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
});

function loginReq(base: string, headers: Record<string, string> = {}): Request {
  return new Request(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
}

/** 从 Set-Cookie 取出 name=value,模拟浏览器之后自动带上的 Cookie 头。 */
function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0];
}

describe('v13.5 · 路由级:局域网 HTTP 拿到的会话真能用', () => {
  it('生产 + http://局域网IP 登录 → Set-Cookie 不带 Secure;只带这枚 cookie(无 Bearer)访问 /api/projects → 200', async () => {
    const res = await loginHandler(loginReq(LAN, { origin: LAN }));
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie') || '';
    expect(sc.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(hasSecure(sc)).toBe(false);

    // 对照:不带任何凭据 → 401(证明下面的 200 是 cookie 挣来的)
    expect((await projectsHandler(req(`${LAN}/api/projects`))).status).toBe(401);
    const list = await projectsHandler(req(`${LAN}/api/projects`, { cookie: cookiePair(sc) }));
    expect(list.status).toBe(200);
  });

  it('生产 + HTTPS 反代(X-Forwarded-Proto: https)登录 → Set-Cookie 带 Secure', async () => {
    const res = await loginHandler(loginReq('http://127.0.0.1:3100', { 'x-forwarded-proto': 'https', origin: PUBLIC }));
    expect(res.status).toBe(200);
    expect(hasSecure(res.headers.get('set-cookie') || '')).toBe(true);
  });

  it('生产 + COOKIE_SECURE=true + HTTP 登录 → 仍带 Secure', async () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    const res = await loginHandler(loginReq(LAN, { origin: LAN }));
    expect(res.status).toBe(200);
    expect(hasSecure(res.headers.get('set-cookie') || '')).toBe(true);
  });

  it('局域网 HTTP 登出 → 清除头不带 Secure(否则浏览器丢弃,cookie 清不掉)', async () => {
    const res = await logoutHandler(req(`${LAN}/api/auth/logout`, { origin: LAN }, { method: 'POST' }));
    const sc = res.headers.get('set-cookie') || '';
    expect(sc).toContain(`${SESSION_COOKIE}=;`);
    expect(sc).toContain('Max-Age=0');
    expect(hasSecure(sc)).toBe(false);
  });
});

describe('v13.5 · /api/auth/me 补发 cookie(升级前就登录的局域网用户自愈)', () => {
  it('Bearer 有效、无 cookie → 补发会话 cookie(局域网 HTTP 不带 Secure),补发的 cookie 单独可用', async () => {
    const token = signToken({ id: USER_ID, role: 'member' });
    // 浏览器同源 GET 不带 Origin、带 Referer(页面地址)—— 照真实请求构造
    const res = await meHandler(req(`${LAN}/api/auth/me`, { authorization: `Bearer ${token}`, referer: `${LAN}/dashboard` }));
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie') || '';
    expect(sc).toBe(`${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
    const list = await projectsHandler(req(`${LAN}/api/projects`, { cookie: cookiePair(sc) }));
    expect(list.status).toBe(200);
  });

  it('HTTPS 下补发的 cookie 带 Secure', async () => {
    const token = signToken({ id: USER_ID, role: 'member' });
    const res = await meHandler(req(`${PUBLIC}/api/auth/me`, { authorization: `Bearer ${token}` }));
    expect(hasSecure(res.headers.get('set-cookie') || '')).toBe(true);
  });

  it('HTTPS 反代没转发协议头(nginx 默认)→ 靠 Referer 判出 https,补发的 cookie 仍带 Secure', async () => {
    // 真浏览器实测抓到的洞:/me 是 GET、不带 Origin;只看 URL/XFP/Origin 会补发不带 Secure 的 cookie
    const token = signToken({ id: USER_ID, role: 'member' });
    const res = await meHandler(
      req('http://127.0.0.1:3100/api/auth/me', { authorization: `Bearer ${token}`, referer: `${PUBLIC}/dashboard` }),
    );
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie') || '';
    expect(sc.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(hasSecure(sc)).toBe(true);
  });

  it('判不出协议(HTTP URL、无代理头、无 Origin/Referer)→ 照常 200,但不补发', async () => {
    const token = signToken({ id: USER_ID, role: 'member' });
    const res = await meHandler(req('http://127.0.0.1:3100/api/auth/me', { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('显式 COOKIE_SECURE=true/false 时不必猜协议 → 判不出也照常补发,Secure 按设置', async () => {
    const token = signToken({ id: USER_ID, role: 'member' });
    const bare = () => meHandler(req('http://127.0.0.1:3100/api/auth/me', { authorization: `Bearer ${token}` }));
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect(hasSecure((await bare()).headers.get('set-cookie') || '')).toBe(true);
    vi.stubEnv('COOKIE_SECURE', 'false');
    const sc = (await bare()).headers.get('set-cookie') || '';
    expect(sc.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(hasSecure(sc)).toBe(false);
  });

  it('cookie 已与 Bearer 一致 → 不重复下发', async () => {
    const token = signToken({ id: USER_ID, role: 'member' });
    const res = await meHandler(
      req(`${LAN}/api/auth/me`, { authorization: `Bearer ${token}`, cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('坏 Bearer + 好 cookie → 照常 200(cookie 兜底),但不拿坏 token 覆盖好 cookie', async () => {
    const token = signToken({ id: USER_ID, role: 'member' });
    const res = await meHandler(
      req(`${LAN}/api/auth/me`, { authorization: 'Bearer not-a-jwt', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('未登录 → 401 且不下发任何 cookie', async () => {
    const res = await meHandler(req(`${LAN}/api/auth/me`));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
