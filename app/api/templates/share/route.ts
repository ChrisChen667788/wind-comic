/**
 * POST /api/templates/share — 创建分享 token
 *   body: { assetId: string }   // 必须是当前用户的 type='template' 资产
 *   200 → { token, url, viewCount, cloneCount, createdAt }
 *   403 → 不是该 asset 的所有者
 *   404 → asset 不存在或非 template 类型
 *
 * GET /api/templates/share — 列出当前用户已创建的所有 token
 *   200 → { tokens: TemplateShareToken[] }
 *
 * DELETE /api/templates/share?token=xxx — 吊销 token (只限创建者)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { getGlobalAssetById } from '@/lib/repos/global-asset-repo'; // v9.0.3b: async, 双驱动
import {
  createShareToken,
  deleteToken,
  listTokensForOwner,
} from '@/lib/template-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

function buildShareUrl(request: Request, token: string): string {
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  return `${proto}://${host}/template/${encodeURIComponent(token)}`;
}

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const assetId = typeof body?.assetId === 'string' ? body.assetId.trim() : '';
  if (!assetId) return NextResponse.json({ error: '缺 assetId' }, { status: 400 });

  const asset = await getGlobalAssetById(assetId);
  if (!asset) return NextResponse.json({ error: 'asset 不存在' }, { status: 404 });
  if (asset.type !== 'template') {
    return NextResponse.json({ error: 'asset 不是模板类型, 不能分享' }, { status: 400 });
  }
  if (asset.userId !== userId) {
    return NextResponse.json({ error: '不能分享别人的模板' }, { status: 403 });
  }

  // v2.19 P0.3: expiresInDays 让用户选 "1天/7天/30天/永久".
  // 上限 365 天 (超过 1 年的"永久" 用 null 表示, 不写过期时间)。
  let expiresAt: string | null = null;
  if (typeof body?.expiresInDays === 'number' && Number.isFinite(body.expiresInDays)) {
    const days = Math.max(1, Math.min(365, Math.floor(body.expiresInDays)));
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const t = await createShareToken({ assetId, ownerUserId: userId, expiresAt });
  return NextResponse.json({
    token: t.token,
    url: buildShareUrl(request, t.token),
    viewCount: t.viewCount,
    cloneCount: t.cloneCount,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
  });
}

export async function GET(request: NextRequest) {
  const userId = resolveUserId(request);
  const tokens = await listTokensForOwner(userId);
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      ...t,
      url: buildShareUrl(request, t.token),
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const userId = resolveUserId(request);
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: '缺 token 参数' }, { status: 400 });
  const ok = await deleteToken(token, userId);
  if (!ok) return NextResponse.json({ error: 'token 不存在或不属于当前用户' }, { status: 404 });
  return NextResponse.json({ deleted: true, token });
}
