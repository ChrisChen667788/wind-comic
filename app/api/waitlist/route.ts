/**
 * /api/waitlist
 *
 * POST  公开：用户申请内测 { email, purpose?, source? }
 * GET   管理员：列表 ?status=pending
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import {
  createWaitlistEntry,
  listWaitlistEntries,
  findWaitlistByEmail,
} from '@/lib/waitlist';
import type { WaitlistEntry } from '@/types/agents';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    purpose?: string;
    source?: string;
  };

  if (!body.email || !EMAIL_RE.test(body.email)) {
    return NextResponse.json({ error: '请提供有效的邮箱' }, { status: 400 });
  }

  // 已有 pending / approved 记录时幂等返回
  const existing = findWaitlistByEmail(body.email);
  const alreadyActive = existing.find(
    e => e.status === 'pending' || e.status === 'approved',
  );
  if (alreadyActive) {
    return NextResponse.json(
      {
        message:
          alreadyActive.status === 'approved'
            ? '您已通过审核，请查收邀请码邮件'
            : '您已在等待列表中，审核通过后会通知您',
        status: alreadyActive.status,
      },
      { status: 200 },
    );
  }

  const entry = createWaitlistEntry({
    email: body.email,
    purpose: body.purpose,
    source: body.source,
  });

  return NextResponse.json(
    { message: '已加入 waitlist，审核结果将发送到您的邮箱', id: entry.id },
    { status: 201 },
  );
}

export async function GET(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get('status') || undefined;
  const entries = listWaitlistEntries({
    status: status as WaitlistEntry['status'] | undefined,
  });
  return NextResponse.json({ entries, total: entries.length });
}
