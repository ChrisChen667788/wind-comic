/**
 * POST /api/projects/[id]/param-sync · v8.2 — 参数联动:把编辑后的 ParamDoc 一次性写回
 *
 * 入参: { doc: ParamDoc }  (每镜 spec + continuity + format)
 * 行为: 每镜 spec → 对应 storyboard 资产 data.cameraSpec; continuity / project-format → upsert。
 * 出参: 200 { ok, syncedShots, continuitySynced, formatSynced }
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, createAsset, updateAsset, listLatestStoryboards } from '@/lib/repos/asset-repo';
import { buildParamDoc } from '@/lib/param-linkage';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function upsert(projectId: string, type: string, name: string, data: unknown) {
  const rows = await listAssetsByType(projectId, type);
  if (rows.length) await updateAsset(rows[0].id, { data });
  else await createAsset({ projectId, type, name, data });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const doc = buildParamDoc({
    shots: Array.isArray(body?.doc?.shots)
      ? body.doc.shots.map((s: any) => ({ shotNumber: Number(s?.shotNumber), cameraSpec: s?.spec }))
      : [],
    continuity: body?.doc?.continuity,
    format: body?.doc?.format,
  });

  // 每镜 spec → storyboard 资产 data.cameraSpec
  // v13.10:写进每镜当前那行(原来 .find 写进第一行 —— 重生过的镜写进旧行,项目页读当前行就看不到)
  const storyboards = await listLatestStoryboards(projectId);
  let syncedShots = 0;
  for (const s of doc.shots) {
    const row = storyboards.find((a) => a.shot_number === s.shotNumber);
    if (!row) continue;
    let data: any = {};
    try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
    data.cameraSpec = s.spec;
    if (await updateAsset(row.id, { data })) syncedShots++;
  }

  await upsert(projectId, 'continuity', 'continuity-settings', doc.continuity);
  await upsert(projectId, 'project-format', 'project-format', doc.format);

  return NextResponse.json({ ok: true, syncedShots, continuitySynced: true, formatSynced: true });
}
