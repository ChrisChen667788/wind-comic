/**
 * POST /api/projects/[id]/shot-spec · v7.2 — 保存单镜头电影摄影规格 (ShotSpec)
 *
 * 把结构化机位规格 (景别/机位/镜头/运镜/焦点/氛围/运动) 落进对应 storyboard 资产的 data.cameraSpec。
 * 不重生成图/视频 — 仅持久化规格, 供"用此机位重生成"或下次导出/生成时消费。
 *
 * 入参: { shotNumber: number, cameraSpec: ShotSpec }
 * 出参: 200 { ok, shotNumber, cameraSpec } / 400 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, updateAsset } from '@/lib/repos/asset-repo';
import { normalizeShotSpec } from '@/lib/cinematography';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const shotNumber = Number(body?.shotNumber);
  if (!Number.isFinite(shotNumber) || shotNumber <= 0) {
    return NextResponse.json({ error: '请指定 shotNumber' }, { status: 400 });
  }
  const spec = normalizeShotSpec(body?.cameraSpec);

  const storyboards = await listAssetsByType(projectId, 'storyboard');
  const row = storyboards.find((a) => a.shot_number === shotNumber);
  if (!row) return NextResponse.json({ error: `未找到分镜 ${shotNumber}` }, { status: 404 });

  let data: any = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  data.cameraSpec = spec;

  const ok = await updateAsset(row.id, { data });
  if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });

  return NextResponse.json({ ok: true, shotNumber, cameraSpec: spec });
}
