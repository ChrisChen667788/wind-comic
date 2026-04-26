/**
 * POST /api/global-assets/[id]/use
 *
 * 记录 projectId 使用了该全局资产（去重累加到 referenced_by_projects）。
 * 用于将来的热度统计 / "已被 X 个项目使用" 徽标。
 *
 * body: { projectId: string }
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { recordAssetUsage } from '@/lib/global-assets';

export const runtime = 'nodejs';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = resolveUserId(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { projectId?: string };
    if (!body.projectId || String(body.projectId).trim().length === 0) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const updated = recordAssetUsage(id, userId, String(body.projectId));
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      id: updated.id,
      referencedByProjects: updated.referencedByProjects,
    });
  } catch (e) {
    if (e instanceof Error && /Forbidden/.test(e.message)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('[API] POST /global-assets/:id/use failed:', e);
    return NextResponse.json({ error: 'Failed to record asset usage' }, { status: 500 });
  }
}
