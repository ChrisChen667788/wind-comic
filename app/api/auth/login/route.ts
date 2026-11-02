import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { signToken, sessionCookieHeader, assertJwtSecretUsable } from '../lib';
import { findUserByEmail } from '@/lib/repos/user-repo';
import { rateLimit, clientIp, isRateLimitActive } from '@/lib/rate-limit';
import { withMisconfigGuard } from '@/lib/server-misconfig';

// v13.11:服务端配错(JWT_SECRET 没设/是占位串、数据库打不开)→ 503 + 原因 + 修法,不再 500。见 lib/server-misconfig。
export const POST = withMisconfigGuard('auth/login', async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ message: 'Missing credentials' }, { status: 400 });
  }

  // 限流:防暴力撞库 —— per(IP+邮箱)10 次/15 分,另设 per IP 粗粒度 50 次/15 分(挡撒网喷洒)。
  if (isRateLimitActive()) {
    const ip = clientIp(request);
    const win = 15 * 60_000;
    const perPair = rateLimit(`login:${ip}:${String(email).toLowerCase()}`, { limit: 10, windowMs: win });
    const perIp = rateLimit(`login-ip:${ip}`, { limit: 50, windowMs: win });
    if (!perPair.allowed || !perIp.allowed) {
      const retry = Math.max(perPair.retryAfterSec, perIp.retryAfterSec);
      return NextResponse.json(
        { message: '登录尝试过于频繁,请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retry) } },
      );
    }
  }

  // v13.11:先确认密钥可用 —— 否则密码错 401、密码对才 500,用户会以为自己记错了密码
  assertJwtSecretUsable();

  // v4.2.1: 走 async user-repo (DbDriver), SQLite/PG 双驱动. 行为不变.
  const user = await findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }

  const token = signToken(user);
  // v10.4.3: 双轨 —— body 继续返回 token(旧前端 Bearer 不破),同时下发 httpOnly cookie
  const res = NextResponse.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, avatarUrl: user.avatar_url, locale: user.locale },
  });
  res.headers.set('Set-Cookie', sessionCookieHeader(token, request));
  return res;
});
