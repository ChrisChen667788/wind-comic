import { NextResponse } from 'next/server';
import { getUserFromRequest, getUserById, sessionCookieResyncHeader } from '../lib';

export async function GET(request: Request) {
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
}
