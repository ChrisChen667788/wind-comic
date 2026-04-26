import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // If no auth, fall back to the first user (demo mode)
  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const projects = (db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').get(userId) as any).count;
  const generations = (db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ?').get(userId) as any).count;
  const cases = (db.prepare('SELECT COUNT(*) as count FROM cases').get() as any).count;

  return NextResponse.json({ projects, generations, cases, uptime: Math.floor(process.uptime()) });
}
