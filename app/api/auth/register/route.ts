import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { now } from '@/lib/db';
import { getDbDriver } from '@/lib/db-driver';
import { signToken, sessionCookieHeader } from '../lib';
import {
  consumeInviteCodeTx,
  isInviteRequired,
  type InviteCodeError,
} from '@/lib/repos/invite-repo'; // v9.0.3: invite-repo (async, 双驱动)
import { findUserByEmail } from '@/lib/repos/user-repo';
import { rateLimit, clientIp, isRateLimitActive } from '@/lib/rate-limit';

const DEFAULT_AVATAR = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#2d1b69"/><circle cx="40" cy="30" r="14" fill="rgba(255,255,255,0.3)"/><ellipse cx="40" cy="68" rx="22" ry="18" fill="rgba(255,255,255,0.2)"/></svg>`)}`;

const INVITE_ERROR_MESSAGES: Record<InviteCodeError, string> = {
  NOT_FOUND: '邀请码不存在，请检查拼写',
  ALREADY_USED: '该邀请码已被使用',
  EXPIRED: '邀请码已过期',
  REVOKED: '邀请码已被撤销',
  INVALID: '邀请码格式无效',
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { email, password, name, inviteCode } = body as {
    email?: string;
    password?: string;
    name?: string;
    inviteCode?: string;
  };

  if (!email || !password || !name) {
    return NextResponse.json({ message: '缺少必填字段' }, { status: 400 });
  }

  // 限流:防注册刷量 —— per IP 10 次/小时。
  if (isRateLimitActive()) {
    const rl = rateLimit(`register-ip:${clientIp(request)}`, { limit: 10, windowMs: 60 * 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { message: '注册过于频繁,请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }
  }

  // Beta 门禁：开启时必须提供有效邀请码
  const inviteRequired = isInviteRequired();
  if (inviteRequired) {
    if (!inviteCode || String(inviteCode).trim().length === 0) {
      return NextResponse.json(
        {
          message: 'Beta 版需要邀请码才能注册，可在首页申请 waitlist',
          code: 'INVITE_REQUIRED',
        },
        { status: 403 },
      );
    }
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json({ message: '该邮箱已被注册' }, { status: 409 });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = nanoid();

  // v4.2.6: 走 DbDriver.transaction (SQLite/PG 双驱动) — 原子性: 先插 user
  // (邀请码 used_by_user_id FK 依赖 user 已存在), 再消费邀请码; 码无效整个事务回滚.
  try {
    await getDbDriver().transaction(async (tx) => {
      await tx.run(
        `INSERT INTO users (id, email, password_hash, name, role, avatar_url, locale, created_at, invite_code_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, passwordHash, name, 'member', DEFAULT_AVATAR, 'zh', now(), null],
      );
      if (inviteRequired) {
        const result = await consumeInviteCodeTx(tx, String(inviteCode), userId);
        if (!result.ok) {
          const msg = INVITE_ERROR_MESSAGES[result.error ?? 'INVALID'];
          throw Object.assign(new Error(msg), { kind: 'invite', code: result.error });
        }
        await tx.run('UPDATE users SET invite_code_used = ? WHERE id = ?', [result.invite!.code, userId]);
      }
    });
  } catch (e) {
    const err = e as Error & { kind?: string; code?: string };
    if (err.kind === 'invite') {
      return NextResponse.json(
        { message: err.message, code: err.code },
        { status: 403 },
      );
    }
    console.error('[register] failed:', e);
    return NextResponse.json({ message: '注册失败，请稍后重试' }, { status: 500 });
  }

  const token = signToken({ id: userId, role: 'member' });
  // v10.4.3: 注册即登录 —— 同步下发 httpOnly 会话 cookie(与 login 一致)
  const res = NextResponse.json(
    {
      token,
      user: { id: userId, email, name, role: 'member', avatarUrl: DEFAULT_AVATAR, locale: 'zh' },
    },
    { status: 201 },
  );
  res.headers.set('Set-Cookie', sessionCookieHeader(token));
  return res;
}
