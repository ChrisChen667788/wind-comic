/**
 * /api/global-assets/[id]
 *
 * GET    获取单个资产
 * PATCH  更新（name/description/tags/thumbnail/visualAnchors/metadata）
 * DELETE 删除
 *
 * 权限：asset.userId 必须等于当前 user；否则 403
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import {
  getGlobalAssetById,
  updateGlobalAsset,
  deleteGlobalAsset,
  type UpdateGlobalAssetInput,
} from '@/lib/global-assets';

export const runtime = 'nodejs';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = resolveUserId(request);
    const { id } = await params;
    const asset = getGlobalAssetById(id);
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (asset.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(asset);
  } catch (e) {
    console.error('[API] GET /global-assets/:id failed:', e);
    return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = resolveUserId(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateGlobalAssetInput;
    const updated = updateGlobalAsset(id, userId, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof Error && /Forbidden/.test(e.message)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('[API] PATCH /global-assets/:id failed:', e);
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = resolveUserId(request);
    const { id } = await params;
    const ok = deleteGlobalAsset(id, userId);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Error && /Forbidden/.test(e.message)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('[API] DELETE /global-assets/:id failed:', e);
    return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 });
  }
}
