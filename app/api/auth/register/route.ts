import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { signToken } from '../lib';
import {
  consumeInviteCode,
  isInviteRequired,
  type InviteCodeError,
} from '@/lib/invite-codes';

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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return NextResponse.json({ message: '该邮箱已被注册' }, { status: 409 });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = nanoid();

  // 原子性执行：先插 user（邀请码的 used_by_user_id FK 依赖 user 已存在），
  // 再消费邀请码；若码无效则整个事务回滚，user 也不会真正写入。
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, avatar_url, locale, created_at, invite_code_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      email,
      passwordHash,
      name,
      'member',
      DEFAULT_AVATAR,
      'zh',
      now(),
      null, // 稍后 UPDATE
    );

    let consumedCode: string | undefined;
    if (inviteRequired) {
      const result = consumeInviteCode(String(inviteCode), userId);
      if (!result.ok) {
        const msg = INVITE_ERROR_MESSAGES[result.error ?? 'INVALID'];
        throw Object.assign(new Error(msg), { kind: 'invite', code: result.error });
      }
      consumedCode = result.invite!.code;
      db.prepare('UPDATE users SET invite_code_used = ? WHERE id = ?').run(consumedCode, userId);
    }

    return consumedCode;
  });

  try {
    tx();
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
  return NextResponse.json(
    {
      token,
      user: { id: userId, email, name, role: 'member', avatarUrl: DEFAULT_AVATAR, locale: 'zh' },
    },
    { status: 201 },
  );
}
