/**
 * POST /api/auth/logout (v10.4.3) — 清除 httpOnly 会话 cookie。
 * 前端 logout 同步调用(fire-and-forget):localStorage 由前端清,cookie 只能由服务端清。
 * 无需鉴权 —— 清自己的 cookie 不构成越权面。
 */
import { NextResponse } from 'next/server';
import { clearSessionCookieHeader } from '../lib';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', clearSessionCookieHeader());
  return res;
}
