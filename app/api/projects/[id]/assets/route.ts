import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import { normalizeAssetRow } from '@/lib/asset-storage';
import { createAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';

// 获取项目资产
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  try {
    const assets = db.prepare(
      'SELECT * FROM project_assets WHERE project_id = ? ORDER BY type, shot_number'
    ).all(projectId);

    const parsed = (assets as any[]).map(a => {
      const { mediaUrls, persistentUrl } = normalizeAssetRow(a);
      return {
        ...a,
        data: JSON.parse(a.data || '{}'),
        mediaUrls,
        persistentUrl,
        shotNumber: a.shot_number,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        projectId: a.project_id,
      };
    });

    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json({ error: '获取资产失败' }, { status: 500 });
  }
}

// 创建资产
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = await request.json();

  try {
    const id = nanoid();
    const timestamp = now();

    await createAsset({
      id, projectId, type: body.type, name: body.name,
      data: body.data || {}, mediaUrls: body.mediaUrls || [],
      shotNumber: body.shotNumber || null, version: 1,
    });

    return NextResponse.json({ id, projectId, ...body, version: 1, createdAt: timestamp, updatedAt: timestamp });
  } catch (error) {
    return NextResponse.json({ error: '创建资产失败' }, { status: 500 });
  }
}
