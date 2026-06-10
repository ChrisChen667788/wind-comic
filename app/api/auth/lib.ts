import jwt from 'jsonwebtoken';
import { db } from '@/lib/db';

// 开发/测试兜底密钥(公开在仓库里,绝不能用于生产)。
const DEV_FALLBACK_SECRET = 'qingfeng-manju-secret';
let warnedDevSecret = false;

/**
 * 运行时解析 JWT 密钥(刻意不在模块顶层求值 —— 避免 `next build` 期间误抛中断构建)。
 *   - 设了 `JWT_SECRET` → 用它。
 *   - 没设 + 生产环境(`NODE_ENV=production`)→ **fail-fast 抛错**:源码内置兜底值是公开的,
 *     任何人都能据此伪造任意用户(含 admin)的登录令牌。
 *   - 没设 + 开发/测试 → 用兜底值(本地方便),首次解析打一次告警提醒部署前必须设置。
 */
function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length > 0) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[auth] JWT_SECRET 未设置 —— 生产环境必须配置一个高强度随机密钥;' +
        '源码内置兜底值是公开的,任何人都能据此伪造登录令牌。',
    );
  }
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn('[auth] ⚠️ JWT_SECRET 未设置,正在使用开发兜底密钥;部署前务必设置 JWT_SECRET。');
  }
  return DEV_FALLBACK_SECRET;
}

export interface JWTPayload {
  sub: string;
  role: string;
}

export function signToken(user: { id: string; role: string }): string {
  return jwt.sign({ sub: user.id, role: user.role }, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, getJwtSecret()) as JWTPayload;
}

// ── v10.4.3: httpOnly 会话 cookie ───────────────────────────────────────────
// 动机:JWT 存 localStorage,任何 XSS 即可窃取令牌;cookie(HttpOnly)对脚本不可见,
// SameSite=Lax 抵御跨站携带。过渡期双轨:登录/注册继续在 body 返回 token(旧前端
// Bearer 不破),同时下发 cookie;服务端双读。SSE/EventSource 设不了请求头,
// cookie 顺带解决其鉴权(lib/sse-client 的 fetch-Bearer 变通将来可退役)。

export const SESSION_COOKIE = 'qfmj-session';
const SESSION_MAX_AGE = 7 * 24 * 3600; // 与 signToken 的 7d 对齐

export function sessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function tokenFromCookie(request: Request): string | null {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * v10.4.3 双读:Authorization Bearer 优先,会话 cookie 兜底。
 * Bearer 在前 —— 显式随请求传的头比环境 cookie 更有「本次请求」的意图性
 * (换账号调试 / E2E mint 时旧 cookie 残留不会抢权)。
 */
export function getUserFromRequest(request: Request): JWTPayload | null {
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  for (const token of [bearer, tokenFromCookie(request)]) {
    if (!token) continue;
    try {
      return verifyToken(token);
    } catch {
      /* 该来源无效,试下一个 */
    }
  }
  return null;
}

export function getUserById(id: string) {
  const user = db
    .prepare(
      'SELECT id, email, name, role, avatar_url, locale, subscription_tier, subscription_status FROM users WHERE id = ?',
    )
    .get(id) as any;
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatar_url,
    locale: user.locale,
    // v2.12 Sprint C.2: 把订阅 tier/status 透传给前端,billing 页面 + 功能 gate 用
    subscriptionTier: user.subscription_tier || 'free',
    subscriptionStatus: user.subscription_status || null,
  };
}
