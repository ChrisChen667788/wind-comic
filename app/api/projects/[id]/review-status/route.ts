/**
 * GET/POST /api/projects/[id]/review-status · v3.x P0.3 E.3
 *
 * GET → ProjectReviewStatus (含 default 'draft' if no record)
 * POST body: { action: 'submit'|'approve'|'request_changes'|'withdraw', note?: string }
 *   submit → in_review
 *   approve → approved
 *   request_changes → changes_requested (note 必填)
 *   withdraw → draft (撤回, 仅 in_review 状态可)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { getReviewStatus, transitionReviewStatus, type ReviewStatus } from '@/lib/review-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string | null {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const fallback = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  return fallback?.id || null;
}

const ACTION_TO_STATUS: Record<string, ReviewStatus> = {
  submit: 'in_review',
  approve: 'approved',
  request_changes: 'changes_requested',
  withdraw: 'draft',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const status = getReviewStatus(projectId);
  return NextResponse.json(status);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const actorId = resolveUserId(request);
  if (!actorId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* allow */ }
  const action = String(body?.action || '');
  const toStatus = ACTION_TO_STATUS[action];
  if (!toStatus) {
    return NextResponse.json({ error: `非法 action: ${action}` }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note : undefined;

  const result = transitionReviewStatus({
    projectId, toStatus, actorUserId: actorId, note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.status);
}
