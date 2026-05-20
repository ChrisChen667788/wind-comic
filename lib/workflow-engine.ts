/**
 * v4.1.1 — Workflow 执行引擎.
 *
 * 拿 v4.1 的 WorkflowGraph, 按 topoSort 分层执行: 层间串行, 层内并行. 每个节点
 * 跑它 kind 对应的 step runner (可插拔注册表), 拿到上游节点的 outputs 作输入,
 * 产出存进共享 context. 失败可 abort (停整条) 或 continue (跳过下游, 其余照跑).
 *
 * runner 注册解耦: 引擎不知道每步具体干啥, 由 registerStepRunner 注入. 测试用
 * mock runner; 生产用 lib/workflow-builtins 注册真 (或 dry-run) runner.
 *
 * 单测: tests/v4-1-1-workflow-engine.test.ts.
 */

import { validateWorkflow, topoSort, type WorkflowGraph, type WorkflowNode, type StepKind } from './agent-workflow';

export interface DepOutput {
  id: string;
  kind: StepKind;
  output: unknown;
}

export interface StepContext {
  node: WorkflowNode;
  /** 工作流级输入 (idea / projectId 等). */
  input: Record<string, unknown>;
  /** 已完成节点的产出, key = node.id. 含本节点所有依赖的输出. */
  outputs: Record<string, unknown>;
  /** 本节点直接依赖的输出 (带 kind), 让 runner 能按 kind 找直接上游产出. */
  depOutputs: DepOutput[];
  /** 所有已完成节点按 kind 索引的产出 (同 kind 取最后一个). pipeline 数据共享: 即使
   *  非直接依赖也能拿到 (如 producer 拿 writer 的 script). */
  upstreamByKind: Partial<Record<StepKind, unknown>>;
  /** 取消信号. */
  signal?: AbortSignal;
}

export type StepRunner = (ctx: StepContext) => Promise<unknown>;

// ─── runner 注册表 ──────────────────────────────────────────────────────────

const runners = new Map<StepKind, StepRunner>();

export function registerStepRunner(kind: StepKind, runner: StepRunner): void {
  runners.set(kind, runner);
}
export function getStepRunner(kind: StepKind): StepRunner | undefined {
  return runners.get(kind);
}
export function clearStepRunners(): void {
  runners.clear();
}
export function listRegisteredStepKinds(): StepKind[] {
  return Array.from(runners.keys());
}

// ─── 执行 ───────────────────────────────────────────────────────────────────

export type StepStatus = 'done' | 'failed' | 'skipped';

export interface StepResult {
  nodeId: string;
  kind: StepKind;
  status: StepStatus;
  output?: unknown;
  error?: string;
  ms: number;
}

export interface ExecuteOptions {
  input?: Record<string, unknown>;
  /** 某步失败时: 'abort' 停整条 (默认) | 'continue' 跳过下游其余照跑. */
  onFailure?: 'abort' | 'continue';
  /** 每次调用专属 runner 覆盖 (优先于全局注册表) — 真实运行注入自己的 orchestrator
   *  runner, 避免并发请求互相覆盖全局注册表. */
  runners?: Partial<Record<StepKind, StepRunner>>;
  onStepStart?: (nodeId: string, kind: StepKind) => void;
  onStepDone?: (nodeId: string, output: unknown) => void;
  onStepError?: (nodeId: string, error: string) => void;
  signal?: AbortSignal;
}

export interface ExecuteResult {
  ok: boolean;
  outputs: Record<string, unknown>;
  steps: StepResult[];
  error?: string;
}

/**
 * 执行一个工作流.
 *   - 先 validate (不过直接返回)
 *   - topoSort 分层, 层间串行 / 层内并行
 *   - 节点跑前若有依赖处于 failed/skipped → 本节点 skipped
 *   - abort 模式: 任一层出现 failed, 该层跑完即停, 余下层全 skipped
 */
export async function executeWorkflow(
  graph: WorkflowGraph,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const v = validateWorkflow(graph);
  if (!v.valid) {
    return { ok: false, outputs: {}, steps: [], error: '工作流校验失败: ' + v.errors.join('; ') };
  }
  const topo = topoSort(graph);
  if (!topo.ok) {
    return { ok: false, outputs: {}, steps: [], error: topo.error };
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const outputs: Record<string, unknown> = {};
  const steps: StepResult[] = [];
  const badSet = new Set<string>(); // failed 或 skipped 的节点 id
  const input = opts.input ?? {};
  const onFailure = opts.onFailure ?? 'abort';
  let aborted = false;

  for (const level of topo.levels) {
    if (aborted) {
      for (const id of level) {
        const node = nodeById.get(id)!;
        badSet.add(id);
        steps.push({ nodeId: id, kind: node.kind, status: 'skipped', ms: 0 });
      }
      continue;
    }

    await Promise.all(level.map(async (id) => {
      const node = nodeById.get(id)!;
      // 依赖里有坏的 → skip
      const depBad = (node.dependsOn || []).some((d) => badSet.has(d));
      if (depBad || opts.signal?.aborted) {
        badSet.add(id);
        steps.push({ nodeId: id, kind: node.kind, status: 'skipped', ms: 0 });
        return;
      }

      const runner = opts.runners?.[node.kind] ?? getStepRunner(node.kind);
      const t0 = Date.now();
      opts.onStepStart?.(id, node.kind);
      if (!runner) {
        const error = `没有注册 ${node.kind} 的 step runner`;
        badSet.add(id);
        steps.push({ nodeId: id, kind: node.kind, status: 'failed', error, ms: Date.now() - t0 });
        opts.onStepError?.(id, error);
        return;
      }
      try {
        const depOutputs: DepOutput[] = (node.dependsOn || []).map((depId) => ({
          id: depId,
          kind: (nodeById.get(depId)?.kind ?? 'custom') as StepKind,
          output: outputs[depId],
        }));
        const upstreamByKind: Partial<Record<StepKind, unknown>> = {};
        for (const [nid, out] of Object.entries(outputs)) {
          const k = nodeById.get(nid)?.kind;
          if (k) upstreamByKind[k] = out;
        }
        const output = await runner({ node, input, outputs, depOutputs, upstreamByKind, signal: opts.signal });
        outputs[id] = output;
        steps.push({ nodeId: id, kind: node.kind, status: 'done', output, ms: Date.now() - t0 });
        opts.onStepDone?.(id, output);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        badSet.add(id);
        steps.push({ nodeId: id, kind: node.kind, status: 'failed', error, ms: Date.now() - t0 });
        opts.onStepError?.(id, error);
      }
    }));

    // 本层有 failed 且 abort → 停
    const levelFailed = steps.some((s) => level.includes(s.nodeId) && s.status === 'failed');
    if (levelFailed && onFailure === 'abort') aborted = true;
  }

  const anyFailed = steps.some((s) => s.status === 'failed');
  return { ok: !anyFailed, outputs, steps, error: anyFailed ? '部分步骤失败' : undefined };
}
