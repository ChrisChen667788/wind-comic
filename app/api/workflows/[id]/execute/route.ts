/**
 * /api/workflows/[id]/execute  · v4.1.1
 *
 * POST 执行一个已保存的工作流 (当前为 dry-run: 跑编排逻辑但不真调 LLM/绘图/视频,
 * 验证顺序/并行/数据流). body: { input?: {...}, onFailure?: 'abort'|'continue' }
 *
 * 真接 HybridOrchestrator 的 runner 见 lib/workflow-builtins (v4.1.2 扩展点).
 *
 * Auth: 需登录, 且只能跑自己的工作流.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { getWorkflow } from '@/lib/agent-workflow';
import { executeWorkflow } from '@/lib/workflow-engine';
import '@/lib/workflow-builtins'; // 注册内置 dry-run runner

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wf = getWorkflow(id);
  if (!wf) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  if (wf.userId !== payload.sub) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const onFailure = body?.onFailure === 'continue' ? 'continue' : 'abort';
  const input = body?.input && typeof body.input === 'object' ? body.input : {};

  const result = await executeWorkflow(wf.graph, { input, onFailure });
  return NextResponse.json({ workflowId: id, dryRun: true, result });
}
