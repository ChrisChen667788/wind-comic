/**
 * /api/cameo-ip/[tokenId]  · v4.0
 *
 * GET    返回 token 详情 + 当前用户的访问级别
 * POST   申请复用授权 (body: { message? }) — 走 grant 流程
 * DELETE 撤销 token (仅 owner)
 *
 * Auth: POST/DELETE 需登录; GET 公开 (无 token 时 level=denied).
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { getIpToken, checkAccess, requestGrant, revokeIpToken, recordTokenUse, importCameoToLibrary } from '@/lib/repos/cameo-ip-repo'; // v9.0.3d: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const payload = getUserFromRequest(request);
  const userId = payload?.sub || '';
  const { level, token } = await checkAccess(tokenId, userId);
  if (!token) return NextResponse.json({ error: 'token 不存在' }, { status: 404 });
  return NextResponse.json({ token, accessLevel: level });
}

export async function POST(request: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const action = body?.action || 'request-grant';

  try {
    if (action === 'use') {
      // 复用计数 (有权才 +1)
      const ok = await recordTokenUse(tokenId, payload.sub);
      if (!ok) return NextResponse.json({ error: '无复用权限' }, { status: 403 });
      return NextResponse.json({ ok: true });
    }
    if (action === 'import') {
      // v4.0.1: 把授权角色导入自己的 character_library, 闭环到创作流程
      const r = await importCameoToLibrary(tokenId, payload.sub);
      if (!r.ok) return NextResponse.json({ error: r.error || '导入失败' }, { status: 403 });
      return NextResponse.json({ ok: true, characterId: r.characterId, alreadyImported: !!r.alreadyImported });
    }
    // default: 申请授权
    const grant = await requestGrant(tokenId, payload.sub, typeof body?.message === 'string' ? body.message : '');
    return NextResponse.json({ grant });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'request failed' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = await getIpToken(tokenId);
  if (!token) return NextResponse.json({ error: 'token 不存在' }, { status: 404 });
  try {
    await revokeIpToken(tokenId, payload.sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'revoke failed' }, { status: 403 });
  }
}
