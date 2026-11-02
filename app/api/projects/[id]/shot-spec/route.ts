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
import { updateAsset, getLatestStoryboard } from '@/lib/repos/asset-repo';
import { normalizeShotSpec } from '@/lib/cinematography';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const shotNumber = Number(body?.shotNumber);
  if (!Number.isFinite(shotNumber) || shotNumber <= 0) {
    return NextResponse.json({ error: '请指定 shotNumber' }, { status: 400 });
  }
  const spec = normalizeShotSpec(body?.cameraSpec);

  // v13.10:写进这一镜当前那行(原来 .find 写进第一行 —— 重生过的镜写进旧行,项目页读当前行就看不到)
  const row = await getLatestStoryboard(projectId, shotNumber);
  if (!row) return NextResponse.json({ error: `未找到分镜 ${shotNumber}` }, { status: 404 });

  let data: any = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  data.cameraSpec = spec;

  const ok = await updateAsset(row.id, { data });
  if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });

  return NextResponse.json({ ok: true, shotNumber, cameraSpec: spec });
}
