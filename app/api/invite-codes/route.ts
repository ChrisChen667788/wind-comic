/**
 * /api/invite-codes  (admin only)
 *
 * GET  查询码列表（可筛选 status / source）
 * POST 批量生成码
 *
 * Auth: JWT role = 'admin'
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import {
  generateInviteCodes,
  listInviteCodes,
  type InviteCodeError,
} from '@/lib/invite-codes';
import type { InviteCode } from '@/types/agents';

export const runtime = 'nodejs';

function requireAdmin(request: Request): { userId: string } | NextResponse {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  return { userId: payload.sub };
}

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const status = request.nextUrl.searchParams.get('status') || undefined;
  const source = request.nextUrl.searchParams.get('source') || undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') || 100);

  const codes = listInviteCodes({
    status: status as InviteCode['status'] | undefined,
    source,
    limit: Number.isFinite(limit) ? limit : 100,
  });
  return NextResponse.json({ codes, total: codes.length });
}

export async function POST(request: Request) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as {
    count?: number;
    source?: string;
  };
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);

  const created = generateInviteCodes(count, auth.userId, body.source);
  return NextResponse.json({ created, total: created.length }, { status: 201 });
}
