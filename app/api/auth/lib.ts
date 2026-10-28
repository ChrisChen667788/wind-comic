import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '@/lib/db';

// 进程级随机开发密钥(惰性生成;仓库里**没有任何可用密钥串**)。
// 重启即失效 —— dev/test 重新登录无妨;泄露的旧硬编码值因此彻底作废。
let devSecret: string | null = null;

/**
 * 已知弱/占位密钥黑名单(v12.219 密钥硬化)。
 * `.env.example` 里的 `change_me_...` 是公开可见的占位值:任何人只要拷模板忘改,
 * 生产就会用这串公开密钥签发/校验令牌 → 可被据此伪造任意用户(含 admin)令牌。
 * 生产环境命中黑名单 = 与未设置同等危险,一律 fail-fast 拒起。
 * 判定用小写去空白规范化,挡「大小写/首尾空格」绕过。
 */
const WEAK_JWT_SECRETS = new Set(
  [
    'change_me_to_a_random_32_char_string', // .env.example 默认占位
    'change_me',
    'changeme',
    'secret',
    'your-secret-key',
    'your_secret_key',
    'e2e-fixture-secret-not-for-prod', // .env.example 里 e2e 示例串,非生产密钥
    // v12.231(收官 · 堵 🟡-24):CI workflow 里的明文夹具密钥。
    // 它们只用于临时 runner,本身不触达线上;真风险是**被人 fork 后复制进生产 env**。
    // 加进黑名单 = 即便复制了,生产也拒启动(纵深防御)。CI 自身不受影响 ——
    // v12.226 已改成「非生产环境采用显式设置的密钥」,只有 production 才 fail-fast。
    'dummy_for_build_only_change_in_production',
    'e2e-ci-fixture-secret-not-for-prod',
  ].map((s) => s.toLowerCase()),
);

function isWeakSecret(s: string): boolean {
  return WEAK_JWT_SECRETS.has(s.trim().toLowerCase());
}

/**
 * 运行时解析 JWT 密钥(刻意不在模块顶层求值 —— 避免 `next build` 期间误抛中断构建)。
 *   - 设了 `JWT_SECRET` 且非弱默认 → 用它(生产/CI/e2e 都走这条)。
 *   - 设了但命中弱默认黑名单 + 生产 → **fail-fast 抛错**:拷模板忘改等同裸奔。
 *   - 没设 + 生产环境(`NODE_ENV=production`)→ **fail-fast 抛错**:绝不静默用弱密钥。
 *   - 没设/弱默认 + 开发/测试 → 生成**进程级随机密钥**(非源码内置,无法被仓库读者据此伪造令牌),
 *     首次打一次告警提醒部署前必须设 JWT_SECRET。
 *
 * 安全说明:历史上这里曾内置公开兜底串,任何人都能据此伪造任意用户(含 admin)的令牌。
 * 改随机后,即便误以 `NODE_ENV≠production` 裸跑,攻击者也拿不到可用密钥;旧泄露值作废。
 */
function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (s && s.length > 0 && !isWeakSecret(s)) return s;
  if (isProd) {
    if (s && isWeakSecret(s)) {
      throw new Error(
        '[auth] JWT_SECRET 是公开占位/弱默认值(如 .env.example 的 change_me_...)—— 生产环境拒启动。' +
          '请用 `openssl rand -hex 32` 生成高强度随机密钥后重设。',
      );
    }
    throw new Error(
      '[auth] JWT_SECRET 未设置 —— 生产环境必须配置一个高强度随机密钥(否则无法签发/校验令牌)。',
    );
  }
  // v12.226 修 v12.219 引入的回归:非生产环境下**显式设置的密钥必须被采用**(哪怕是弱串),
  // 只告警不替换。原实现把弱串忽略掉改用进程级随机密钥,会让「多进程共用一个 fixture 密钥」
  // 的场景直接崩 —— 典型如 e2e:dev server 与 playwright 测试进程各自随机 → JWT 不匹配 → 全 401,
  // 而 `.env.example` 恰恰就教用户用 `JWT_SECRET=e2e-fixture-secret-not-for-prod` 跑本地 e2e。
  // 黑名单的职责是**拦生产**(上面已 fail-fast),不该越界破坏开发/测试工作流。
  if (s && s.length > 0) {
    if (isWeakSecret(s)) {
      console.warn('[auth] ⚠️ JWT_SECRET 为弱默认/占位值(仅开发/测试可用,生产会拒启动);部署前务必设为高强度随机串。');
    }
    return s;
  }
  if (!devSecret) {
    devSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] ⚠️ JWT_SECRET 未设置,已生成进程级随机开发密钥(重启失效);部署前务必设置 JWT_SECRET。');
  }
  return devSecret;
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

// ── v13.5: Secure 跟着「这次请求实际是不是 HTTPS」走 ──────────────────────────
// 此前 `NODE_ENV=production` 就无条件加 Secure。自托管用户(NAS)常直接开
// http://<局域网IP>:3100 —— 浏览器在非安全来源下**丢弃** Secure cookie(localhost 例外,
// 所以本机怎么测都正常)。登录本身靠 localStorage 的 Bearer 照样成功,可 ~34 个只靠
// cookie 的裸 fetch(含 /api/create-stream)全部 401:看着已登录,一点「开机」就「创作需要登录」。
//
// COOKIE_SECURE=auto(默认)| true | false:
//   - true  恒加 Secure(纯 HTTPS 部署想钉死就设它)
//   - false 恒不加(明确只走内网 HTTP)
//   - auto  请求被判定为 HTTPS 才加,判定见 isHttpsRequest
export type CookieSecureMode = 'auto' | 'true' | 'false';

let warnedBadMode = false;
let warnedForcedOverHttp = false;
let warnedAutoPlainHttp = false;

/** 测试辅助:复位「每进程只告警一次」的标记。 */
export function _resetCookieSecureWarnings(): void {
  warnedBadMode = false;
  warnedForcedOverHttp = false;
  warnedAutoPlainHttp = false;
}

export function cookieSecureMode(): CookieSecureMode {
  const v = (process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (v === 'true' || v === '1') return 'true';
  if (v === 'false' || v === '0') return 'false';
  if (v && v !== 'auto' && !warnedBadMode) {
    warnedBadMode = true;
    console.warn(`[auth] COOKIE_SECURE=${v} 无法识别,按 auto 处理(可选 auto / true / false)。`);
  }
  return 'auto';
}

/**
 * 这次请求在浏览器那一侧是不是 HTTPS。任一信号说是 https 就算是:
 *   1. URL 协议 —— Next 已按 socket TLS / X-Forwarded-Proto 推好(next-server attachRequestMeta);
 *   2. X-Forwarded-Proto / Forwarded: proto= —— 反代转发的原始协议(不依赖 Next 内部实现);
 *   3. Origin / Referer —— 浏览器自报的页面地址。同源 POST(登录/注册/登出)必带 Origin;
 *      同源 GET(/api/auth/me 补发)不带 Origin,按默认 Referrer-Policy 会带 Referer。
 *      兜住「HTTPS 反代没转发 X-Forwarded-Proto」(nginx/Apache 默认配置就不转):
 *      此时前两条都说 http,只看它们会让公网 HTTPS 部署的 cookie 丢掉 Secure。
 *
 * 为什么不像 clientIp 那样要求 TRUST_PROXY_HEADERS:这些头**只能把结果推向「加 Secure」**。
 * 伪造它们的人最多让自己的 cookie 被自己的浏览器丢掉;没法替别人把 Secure 摘掉 ——
 * 摘掉需要所有信号都说 http,而受害者浏览器发来的请求头不由攻击者控制。
 */
export function isHttpsRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch {
    /* 相对/畸形 URL:看下面的头 */
  }
  const xfp = request.headers.get('x-forwarded-proto') || '';
  // 多级代理会拼成「https, http」—— 首段是面向浏览器的那一跳,但任何一段是 https 都偏向加 Secure
  if (xfp.split(',').some((p) => p.trim().toLowerCase() === 'https')) return true;
  const fwd = request.headers.get('forwarded') || '';
  if (/(?:^|[;,\s])proto="?https"?(?:[;,\s]|$)/i.test(fwd)) return true;
  return browserPageUrl(request).toLowerCase().startsWith('https://');
}

/** 浏览器自报的页面地址:Origin 优先,没有就用 Referer;都没有返回空串。 */
function browserPageUrl(request: Request): string {
  return request.headers.get('origin') || request.headers.get('referer') || '';
}

/** 本次响应下发的会话 cookie 是否带 Secure。 */
export function shouldUseSecureCookie(request: Request): boolean {
  const mode = cookieSecureMode();
  const https = isHttpsRequest(request);
  if (mode === 'true') {
    if (!https && !warnedForcedOverHttp) {
      warnedForcedOverHttp = true;
      console.warn(
        '[auth] COOKIE_SECURE=true,但收到的是 HTTP 请求 —— 浏览器会丢弃会话 cookie,' +
          '创作/项目列表等接口将 401。用 http://局域网IP 直连请改回 COOKIE_SECURE=auto。',
      );
    }
    return true;
  }
  if (mode === 'false') return false;
  if (!https && process.env.NODE_ENV === 'production' && !warnedAutoPlainHttp) {
    warnedAutoPlainHttp = true;
    console.warn(
      '[auth] 收到 HTTP 请求,会话 cookie 不带 Secure(局域网直连属正常)。' +
        '若这是公网 HTTPS 部署,请让反代转发 X-Forwarded-Proto,或设 COOKIE_SECURE=true。',
    );
  }
  return https;
}

export function sessionCookieHeader(token: string, request: Request): string {
  const secure = shouldUseSecureCookie(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

/** 清除头的 Secure 必须与下发时同一判定:HTTP 来源下带 Secure 的 Set-Cookie 会被整条丢弃,cookie 就清不掉。 */
export function clearSessionCookieHeader(request: Request): string {
  const secure = shouldUseSecureCookie(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function tokenFromCookie(request: Request): string | null {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function tokenFromBearer(request: Request): string | null {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * v13.5 会话自愈:Bearer 有效、但 cookie 缺失或与之不一致 → 返回补发的 Set-Cookie,否则 null。
 * 由 /api/auth/me 调用(前端每次加载页面都会带 Bearer 调它)。治的是**升级前就登录**的
 * 局域网用户:当时的 Secure cookie 被浏览器丢了,localStorage 里的 token 还在 ——
 * 不补发的话,他们升级后看着已登录、点创作仍 401,只能自己猜到要先退出再登录。
 * 补发不扩大暴露面:能带上 Bearer 的脚本本来就拿得到这枚 token。
 */
export function sessionCookieResyncHeader(request: Request): string | null {
  const bearer = tokenFromBearer(request);
  if (!bearer || tokenFromCookie(request) === bearer) return null;
  // 判不出协议就不补发:HTTPS 反代没转发协议头、浏览器又没带 Origin/Referer 时,
  // auto 会判成 http 而发出不带 Secure 的 cookie —— 宁可让这位用户重新登录一次。
  if (cookieSecureMode() === 'auto' && !isHttpsRequest(request) && !/^http:\/\//i.test(browserPageUrl(request))) {
    return null;
  }
  try {
    verifyToken(bearer);
  } catch {
    return null;
  }
  return sessionCookieHeader(bearer, request);
}

/**
 * v10.4.3 双读:Authorization Bearer 优先,会话 cookie 兜底。
 * Bearer 在前 —— 显式随请求传的头比环境 cookie 更有「本次请求」的意图性
 * (换账号调试 / E2E mint 时旧 cookie 残留不会抢权)。
 */
export function getUserFromRequest(request: Request): JWTPayload | null {
  for (const token of [tokenFromBearer(request), tokenFromCookie(request)]) {
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
