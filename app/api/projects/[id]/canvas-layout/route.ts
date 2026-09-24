/**
 * /api/projects/[id]/canvas-layout · v12.454 — 画布节点位置。
 *
 * GET   → `{ positions }`(没存过就是 `{}`,旧项目零影响)
 * PATCH → `{ positions: { 'node-video': { x, y }, … } }`
 *
 * 权限:读 view / 写 edit。改的是这个项目的画布布局,只读协作者不能改。
 * 校验走 lib/canvas-layout 的白名单,**非法值直接 400**:静默丢弃会让「保存成功」和「其实没存」长得一样。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { getDbDriver } from '@/lib/db-driver';
import { parseCanvasPositions, sanitizeCanvasPositions } from '@/lib/canvas-layout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 八个节点的位置,正常 < 400 字节。封顶同时挡住「把任意大的请求体整个读进内存」(v12.448 第二轮的同类) */
const BODY_CAP = 8 * 1024;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'view');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });

  const row = await getDbDriver().get<{ canvas_layout: string | null }>(
    'SELECT canvas_layout FROM projects WHERE id = ?', [id],
  );
  return NextResponse.json({ positions: parseCanvasPositions(row?.canvas_layout) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'edit');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });

  if (Number(request.headers.get('content-length') || 0) > BODY_CAP) {
    return NextResponse.json({ error: '请求体过大' }, { status: 413 });
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: '读不到请求体' }, { status: 400 });
  }
  if (raw.length > BODY_CAP) return NextResponse.json({ error: '请求体过大' }, { status: 413 });
  if (!raw.trim()) return NextResponse.json({ error: '请求体为空' }, { status: 400 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 }); }

  const checked = sanitizeCanvasPositions((body as { positions?: unknown })?.positions);
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 });

  // **不动 updated_at**:布局是显示辅助数据,拖一下节点不该让项目在「最近修改」列表里窜到最前
  // (项目列表按 updated_at 排序 —— 对抗复查挖出)
  await getDbDriver().run('UPDATE projects SET canvas_layout = ? WHERE id = ?', [
    JSON.stringify(checked.positions), id,
  ]);
  return NextResponse.json({ ok: true, positions: checked.positions });
}
