/**
 * v4.1.3 — 工作流接真 orchestrator 执行.
 *
 * v4.1.1/.2 是 dry-run + mock. 这里让自定义 DAG 真跑 HybridOrchestrator 的
 * run* 方法 (需 project 上下文 + LLM key). 用 per-call runners (不污染全局注册表),
 * 并发安全.
 *
 * 能力门: 没配 LLM key 直接拒 real, 返清晰错误 (引擎不空跑烧钱/报错).
 * orchestrator 是单实例传给所有 step → this 状态在 director→writer→... 间累积,
 * 与原单体流水线一致.
 *
 * 单测: tests/v4-1-3-real-runner.test.ts (注入 mock orchestrator, 不跑真 pipeline).
 */

import { API_CONFIG } from './config';
import { executeWorkflow, type ExecuteResult } from './workflow-engine';
import { buildOrchestratorRunners, type OrchestratorLike } from './workflow-orchestrator-runners';
import type { WorkflowGraph } from './agent-workflow-core';

export interface RealRunInput {
  idea: string;
  projectId?: string;
}

export interface RealRunCapability {
  llm: boolean;
  reason?: string;
}

/** 真实运行可用性: 当前只硬性要求 LLM key (director/writer 必跑). */
export function checkRealRunCapability(): RealRunCapability {
  const hasLlm = !!API_CONFIG.openai?.apiKey;
  return hasLlm ? { llm: true } : { llm: false, reason: '未配置 LLM API key (.env.local 的 OPENAI_API_KEY)' };
}

/** v4.1.5: 执行期回调 (推 SSE 进度用), 透传给引擎. */
export interface RealRunHooks {
  onStepStart?: (nodeId: string, kind: string) => void;
  onStepDone?: (nodeId: string, output: unknown) => void;
  onStepError?: (nodeId: string, error: string) => void;
}

/**
 * 真跑工作流. injectedOrch 给测试注入 mock; 生产不传则 new HybridOrchestrator().
 * 无能力且没注入 → 返回 ok:false (不抛, 让路由返 400).
 * hooks: v4.1.5 执行期回调, 透传给引擎驱动 SSE.
 */
export async function runWorkflowReal(
  graph: WorkflowGraph,
  input: RealRunInput,
  injectedOrch?: OrchestratorLike,
  hooks?: RealRunHooks,
): Promise<ExecuteResult & { mode: 'real' }> {
  if (!injectedOrch) {
    const cap = checkRealRunCapability();
    if (!cap.llm) {
      return { mode: 'real', ok: false, outputs: {}, steps: [], error: cap.reason };
    }
  }
  if (!input.idea || !input.idea.trim()) {
    return { mode: 'real', ok: false, outputs: {}, steps: [], error: '真实运行需要 idea (创意输入)' };
  }

  let orch = injectedOrch;
  if (!orch) {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    orch = new HybridOrchestrator() as unknown as OrchestratorLike;
  }

  // per-call runners — 不动全局注册表, 并发安全
  const runners = buildOrchestratorRunners(orch);
  const result = await executeWorkflow(graph, {
    input: { idea: input.idea, projectId: input.projectId },
    onFailure: 'abort',
    runners,
    onStepStart: hooks?.onStepStart,
    onStepDone: hooks?.onStepDone,
    onStepError: hooks?.onStepError,
  });

  // v4.1.4: 真实运行落盘 — 给了 projectId 就把结果摘要存成项目资产 (best-effort)
  if (input.projectId) {
    try {
      const { createAsset } = await import('./repos/asset-repo');
      await createAsset({
        projectId: input.projectId,
        type: 'workflow-run',
        name: `工作流运行 · ${graph.name}`,
        data: {
          workflowId: graph.id,
          ok: result.ok,
          idea: input.idea,
          steps: result.steps.map((s) => ({ nodeId: s.nodeId, kind: s.kind, status: s.status, ms: s.ms })),
          outputs: result.outputs,
          ranAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.warn('[workflow-real] 落盘 project 失败 (non-fatal):', e instanceof Error ? e.message : e);
    }
  }

  return { mode: 'real', ...result };
}
