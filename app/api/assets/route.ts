import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeAssetRow } from '@/lib/asset-storage';
import { getUserFromRequest } from '../auth/lib';
import { requireProjectAccess } from '@/lib/auth-guard';
import { getAsset, deleteAsset } from '@/lib/repos/asset-repo';
import { getOwnedProject, listProjectsByUser } from '@/lib/repos/project-repo';

export const runtime = 'nodejs';

// GET /api/assets?projectId=xxx — 获取项目已确认的资产
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId');
  const confirmed = request.nextUrl.searchParams.get('confirmed');
  const type = request.nextUrl.searchParams.get('type');

  // v12.218(安全止血):此 GET 曾无属主校验,?projectId= 即枚举下载他人图/视频/TTS。
  // 改成要求 projectId + view 权限,并**取消了无 projectId 的全表扫**。
  //
  // v12.345:那次修复对了一半 —— 素材库页面调的正是 `fetch('/api/assets')`(不带
  // projectId),于是一路 400,**整个素材库空白至今**。owner 报「素材库看不见」就是这个。
  // 修接口没跟消费方,是本项目的老毛病。
  //
  // 正确解不是退回全表扫,而是补一条**用户自己作用域**的列表:无 projectId 时
  // 只列该用户名下项目的资产。枚举他人资产的洞依然堵着 —— 项目集合来自
  // listProjectsByUser(登录用户),不接受任何外部传入的 id。
  if (!projectId) {
    const u = getUserFromRequest(request);
    if (!u?.sub) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const mine = await listProjectsByUser(u.sub);
    if (mine.length === 0) return NextResponse.json([]);
    const ids = mine.map((p) => p.id);
    const ph = ids.map(() => '?').join(',');
    const params: unknown[] = [...ids];
    let q = `SELECT * FROM project_assets WHERE project_id IN (${ph})`;
    if (confirmed === 'true') q += ' AND confirmed = 1';
    if (type) { q += ' AND type = ?'; params.push(type); }
    q += ' ORDER BY created_at DESC';
    const rows = db.prepare(q).all(...(params as any[])) as any[];
    return NextResponse.json(rows.map((a) => {
      const { mediaUrls, persistentUrl } = normalizeAssetRow(a);
      return {
        id: a.id, projectId: a.project_id, type: a.type, name: a.name,
        data: JSON.parse(a.data || '{}'), mediaUrls, persistentUrl,
        shotNumber: a.shot_number, confirmed: !!a.confirmed,
        version: a.version, createdAt: a.created_at, updatedAt: a.updated_at,
      };
    }));
  }
  const g = await requireProjectAccess(request, projectId, 'view');
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

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
