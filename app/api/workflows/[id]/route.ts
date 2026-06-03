/**
 * /api/workflows/[id]  · v4.1
 *
 * GET    工作流详情 + 拓扑分层 (执行计划预览)
 * DELETE 删除 (仅创建者)
 *
 * Auth: 需登录.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { getWorkflow, deleteWorkflow, topoSort } from '@/lib/agent-workflow';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const wf = await getWorkflow(id);
  if (!wf) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  if (wf.userId !== payload.sub) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const topo = topoSort(wf.graph);
  return NextResponse.json({ workflow: wf, plan: topo.ok ? topo.levels : null });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const ok = await deleteWorkflow(id, payload.sub);
    if (!ok) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 403 });
  }
}
