import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeAssetRow } from '@/lib/asset-storage';
import { getUserFromRequest } from '../auth/lib';
import { getAsset, deleteAsset } from '@/lib/repos/asset-repo';
import { getOwnedProject } from '@/lib/repos/project-repo';

export const runtime = 'nodejs';

// GET /api/assets?projectId=xxx — 获取项目已确认的资产
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId');
  const confirmed = request.nextUrl.searchParams.get('confirmed');
  const type = request.nextUrl.searchParams.get('type');

  try {
    let query = 'SELECT * FROM project_assets WHERE 1=1';
    const params: any[] = [];

    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }

    if (confirmed === 'true') {
      query += ' AND confirmed = 1';
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC';

    const assets = db.prepare(query).all(...params) as any[];

    return NextResponse.json(
      assets.map(a => {
        const { mediaUrls, persistentUrl } = normalizeAssetRow(a);
        return {
          id: a.id,
          projectId: a.project_id,
          type: a.type,
          name: a.name,
          data: JSON.parse(a.data || '{}'),
          mediaUrls,
          persistentUrl,
          shotNumber: a.shot_number,
          version: a.version,
          confirmed: !!a.confirmed,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        };
      })
    );
  } catch (e) {
    console.error('[API] Assets query failed:', e);
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
  }
}

// DELETE /api/assets?id=<assetId> — 删除单个资产(属主守卫:资产→项目→用户)
export async function DELETE(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ message: '缺 id' }, { status: 400 });
  const asset = await getAsset(id);
  if (!asset) return NextResponse.json({ message: '资产不存在' }, { status: 404 });
  if (!(await getOwnedProject(asset.project_id, payload.sub))) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  const ok = await deleteAsset(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
