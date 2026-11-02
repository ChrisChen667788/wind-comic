import { NextResponse } from 'next/server';
import { getUserFromRequest, getUserById, sessionCookieResyncHeader } from '../lib';
import { withMisconfigGuard } from '@/lib/server-misconfig';

// v13.11:页面一加载就会带着旧令牌调这里 —— 数据库打不开时回 503 + 原因,而不是 500。
// (JWT_SECRET 配错时 getUserFromRequest 校验不了令牌,照旧 401:前端清掉本地令牌;再登录时登录页会提示原因。)
export const GET = withMisconfigGuard('auth/me', async (request: Request) => {
  const payload = getUserFromRequest(request);
  if (!payload) {
    return NextResponse.json({ message: 'Missing token' }, { status: 401 });
  }

  const user = getUserById(payload.sub);
  if (!user) {
    return NextResponse.json({ message: 'User not found' }, { status: 404 });
  }

  const res = NextResponse.json(user);
  // v13.5:前端加载页面都会带 Bearer 调这里 —— 顺手把缺失/过期的会话 cookie 补上(见 lib 注释)
  const resync = sessionCookieResyncHeader(request);
  if (resync) res.headers.set('Set-Cookie', resync);
  return res;
});
