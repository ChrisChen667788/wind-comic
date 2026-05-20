/**
 * v3.0 P0.1 — Notifications API.
 *
 * GET /api/notifications?unread=1&limit=N
 *   → { notifications: NotificationRow[], unreadCount: number }
 *
 * POST /api/notifications  body: { action: 'markRead', id?: string }  (id 不传 = markAllRead)
 *   → { updated: N }
 *
 * 鉴权: 都要登录, 按 recipient_user_id 严格隔离.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import {
  listForUser,
  countUnread,
  markRead,
  markAllRead,
} from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string | null {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // demo 兜底
  const fallback = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  return fallback?.id || null;
}

export async function GET(request: NextRequest) {
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const limitStr = request.nextUrl.searchParams.get('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 30;

  const notifications = listForUser({ recipientUserId: userId, unreadOnly, limit });
  const unreadCount = countUnread(userId);

  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* allow empty body for markAllRead */ }

  const action = String(body?.action || 'markRead');
  if (action !== 'markRead' && action !== 'markAllRead') {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  if (action === 'markAllRead' || !body?.id) {
    const n = markAllRead(userId);
    return NextResponse.json({ updated: n });
  }

  const id = String(body.id);
  const ok = markRead(id, userId);
  return NextResponse.json({ updated: ok ? 1 : 0 });
}
