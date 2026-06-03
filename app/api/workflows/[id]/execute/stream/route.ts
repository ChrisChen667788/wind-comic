/**
 * /api/workflows/[id]/execute/stream  · v4.1.5
 *
 * SSE 版工作流执行. POST { mode?: 'dry-run'|'real', input?, onFailure? }.
 * 实时推每步: step-start → step-done/step-error → 最终 done{result} / error.
 *
 * 对比同步 /execute: 拖拽编辑器能边跑边亮每个节点状态, 不必等整条跑完.
 *
 * Auth: 需登录, 仅自己的工作流.
 */
import { getUserFromRequest } from '../../../../auth/lib';
import { getWorkflow } from '@/lib/agent-workflow';
import { executeWorkflow } from '@/lib/workflow-engine';
import { runWorkflowReal, checkRealRunCapability } from '@/lib/workflow-real-runner';
import { createSSEResponse, type SSESend } from '@/lib/sse';
import '@/lib/workflow-builtins';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const wf = await getWorkflow(id);
  if (!wf) return new Response(JSON.stringify({ error: '工作流不存在' }), { status: 404 });
  if (wf.userId !== payload.sub) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const mode = body?.mode === 'real' ? 'real' : 'dry-run';
  const onFailure = body?.onFailure === 'continue' ? 'continue' : 'abort';
  const input = body?.input && typeof body.input === 'object' ? body.input : {};

  if (mode === 'real') {
    const cap = checkRealRunCapability();
    if (!cap.llm) return new Response(JSON.stringify({ error: cap.reason }), { status: 400 });
  }

  return createSSEResponse(async (send: SSESend) => {
    const hooks = {
      onStepStart: (nodeId: string, kind: string) => send({ event: 'step-start', data: { nodeId, kind } }),
      onStepDone: (nodeId: string) => send({ event: 'step-done', data: { nodeId } }),
      onStepError: (nodeId: string, error: string) => send({ event: 'step-error', data: { nodeId, error } }),
    };
    send({ event: 'start', data: { workflowId: id, mode } });

    if (mode === 'real') {
      const result = await runWorkflowReal(wf.graph, { idea: String(input.idea ?? ''), projectId: input.projectId }, undefined, hooks);
      send({ event: 'done', data: { dryRun: false, result } });
      return;
    }
    const result = await executeWorkflow(wf.graph, {
      input,
      onFailure,
      onStepStart: hooks.onStepStart,
      onStepDone: hooks.onStepDone,
      onStepError: hooks.onStepError,
    });
    send({ event: 'done', data: { dryRun: true, result } });
  });
}
