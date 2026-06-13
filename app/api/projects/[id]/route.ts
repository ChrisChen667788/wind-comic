import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { normalizeAssetRow } from '@/lib/asset-storage';
import { listProjectAssets, getAsset, updateAssetDataInProject } from '@/lib/repos/asset-repo';
import { getOwnedProject, deleteProjectCascade, setProjectArchived } from '@/lib/repos/project-repo';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 先尝试直接查询项目（不限制user_id，因为演示环境）
  let row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;

  // 如果没找到，再尝试用user_id查询
  if (!row) {
    const payload = getUserFromRequest(request);
    const userId = payload?.sub || 'demo-user';
    row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as any;
  }

  if (!row) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // 加载项目资产 — v4.2.3: 走 async asset-repo (DbDriver), SQLite/PG 双驱动
  const assets = await listProjectAssets(id) as any[];
  const parsedAssets = assets.map(a => {
    const { mediaUrls, persistentUrl } = normalizeAssetRow(a);
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      data: JSON.parse(a.data || '{}'),
      mediaUrls,
      persistentUrl,
      shotNumber: a.shot_number,
      version: a.version,
      updatedAt: a.updated_at, // v6.4: 导演台 stale 判定用
      stale: !!a.stale, // v6.4.1: 显式失效标记 (重跑端点置位)
    };
  });

  return NextResponse.json({
    id: row.id,
    // v3.1.3 fix: 透传 user_id — 让前端 isOwner 判断生效 (InviteProjectButton 需要)
    userId: row.user_id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    covers: JSON.parse(row.cover_urls || '[]'),
    status: row.status,
    // v2.9: 把 style_id / primary_character_ref 吐给前端,UI 能按项目锁死风格与主角脸
    styleId: row.style_id || null,
    primaryCharacterRef: row.primary_character_ref || null,
    // v2.12 Phase 1: 多角色锁脸 — 1-3 个角色的脸图 + 名字 + 定位 + cw
    // shape: Array<{ name: string, role: 'lead'|'antagonist'|'supporting'|'cameo', cw: number, imageUrl: string }>
    lockedCharacters: (() => {
      try { return JSON.parse(row.locked_characters || '[]'); } catch { return []; }
    })(),
    scriptData: row.script_data ? JSON.parse(row.script_data) : null,
    directorNotes: row.director_notes ? JSON.parse(row.director_notes) : null,
    assets: parsedAssets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as any;
  if (!project) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  // v11.2.0: 归档/恢复(下架/上架)—— {status:'archived'|'active'} 走属主守卫
  if (typeof body?.status === 'string' && body.assetId === undefined) {
    const payload = getUserFromRequest(request);
    if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    const ok = await setProjectArchived(id, payload.sub, body.status === 'archived');
    return NextResponse.json({ ok });
  }

  const { assetId, data } = body;

  if (!assetId || data === undefined) {
    return NextResponse.json({ message: 'assetId and data are required' }, { status: 400 });
  }

  const asset = await getAsset(assetId);
  if (!asset || asset.project_id !== id) return NextResponse.json({ message: 'Asset not found' }, { status: 404 });

  await updateAssetDataInProject(assetId, id, data);

  return NextResponse.json({ success: true });
}

/** v11.2.0: 删除项目(级联清子表)。属主守卫。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const ok = await deleteProjectCascade(id, payload.sub);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
