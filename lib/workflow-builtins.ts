/**
 * v4.1.1 — 内置 step runner (dry-run 版).
 *
 * 给执行引擎注册每种 StepKind 的 runner. 这一版是 **dry-run**: 不真调 LLM/绘图/视频,
 * 只产出结构化占位输出 + 回显依赖, 用来验证整条工作流编排能跑通 (顺序/并行/数据流).
 * 真正接 HybridOrchestrator 的 runner 是清晰的扩展点 (v4.1.2): 把下面每个
 * dryRun(...) 换成调 orchestrator.runXxx 即可.
 *
 * 用法: import './workflow-builtins' 一次即注册全部 (registerBuiltinStepRunners()).
 */

import { registerStepRunner, type StepContext } from './workflow-engine';
import { STEP_CATALOG, type StepKind } from './agent-workflow';

/** dry-run 产出: 标记 kind + 该步声称产出的 artifact + 它消费到的依赖输出键. */
function dryRun(kind: StepKind) {
  return async (ctx: StepContext) => {
    const cat = STEP_CATALOG[kind];
    return {
      kind,
      dryRun: true,
      produced: cat?.produces ?? [],
      consumedFrom: ctx.node.dependsOn ?? [],
      label: ctx.node.label,
    };
  };
}

/** 注册全部内置 dry-run runner. 幂等 (registerStepRunner 覆盖式), 可在 clear 后重注册. */
export function registerBuiltinStepRunners(): void {
  (Object.keys(STEP_CATALOG) as StepKind[]).forEach((kind) => {
    registerStepRunner(kind, dryRun(kind));
  });
}

// import 即注册 (server 端)
registerBuiltinStepRunners();
