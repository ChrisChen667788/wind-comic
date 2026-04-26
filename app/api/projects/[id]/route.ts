import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { normalizeAssetRow } from '@/lib/asset-storage';

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

  // 加载项目资产
  const assets = db.prepare('SELECT * FROM project_assets WHERE project_id = ? ORDER BY type, shot_number').all(id) as any[];
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
    };
  });

  return NextResponse.json({
    id: row.id,
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

  const { assetId, data } = body;

  if (!assetId || data === undefined) {
    return NextResponse.json({ message: 'assetId and data are required' }, { status: 400 });
  }

  const asset = db.prepare('SELECT id FROM project_assets WHERE id = ? AND project_id = ?').get(assetId, id) as any;
  if (!asset) return NextResponse.json({ message: 'Asset not found' }, { status: 404 });

  db.prepare('UPDATE project_assets SET data = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(JSON.stringify(data), now(), assetId, id);

  return NextResponse.json({ success: true });
}
