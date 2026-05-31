/**
 * /api/cameo-ip/grants  · v4.0
 *
 * GET   当前用户作为 owner 收到的待批授权申请
 * PATCH 审批一条 (body: { grantId, approve: boolean })
 *
 * Auth: 需登录.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { listPendingGrantsForOwner, decideGrant } from '@/lib/repos/cameo-ip-repo'; // v9.0.3d: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ pending: await listPendingGrantsForOwner(payload.sub) });
}

export async function PATCH(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const grantId = typeof body?.grantId === 'string' ? body.grantId : '';
  if (!grantId) return NextResponse.json({ error: 'grantId 必填' }, { status: 400 });

  try {
    const grant = await decideGrant(grantId, payload.sub, !!body?.approve);
    return NextResponse.json({ grant });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'decide failed' }, { status: 403 });
  }
}
