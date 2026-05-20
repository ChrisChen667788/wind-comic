import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { signToken } from '../lib';
import { findUserByEmail } from '@/lib/repos/user-repo';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ message: 'Missing credentials' }, { status: 400 });
  }

  // v4.2.1: 走 async user-repo (DbDriver), SQLite/PG 双驱动. 行为不变.
  const user = await findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }

  const token = signToken(user);
  return NextResponse.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, avatarUrl: user.avatar_url, locale: user.locale },
  });
}
