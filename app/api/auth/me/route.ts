import { NextResponse } from 'next/server';
import { getUserFromRequest, getUserById } from '../lib';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) {
    return NextResponse.json({ message: 'Missing token' }, { status: 401 });
  }

  const user = getUserById(payload.sub);
  if (!user) {
    return NextResponse.json({ message: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(user);
}
