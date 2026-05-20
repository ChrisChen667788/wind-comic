/**
 * v4.1.2 — 真 orchestrator step runner 适配器.
 *
 * 把 v4.1.1 引擎的 StepKind 桥到真 HybridOrchestrator 的 run* 方法. 之前 builtins
 * 是 dry-run; 这层让自定义 DAG 真跑 pipeline.
 *
 * 解耦: 依赖 `OrchestratorLike` 接口 (只声明用得到的方法), 真 HybridOrchestrator 实现它,
 * 测试用 mock. runner 从 ctx.depOutputs 按 kind 取上游产出, 不依赖节点 id.
 *
 * 单测: tests/v4-1-2-orchestrator-runners.test.ts.
 */

import type { StepContext, StepRunner } from './workflow-engine';
import { registerStepRunner } from './workflow-engine';
import type { StepKind } from './agent-workflow';

/** 适配器只需要这些方法; 真 HybridOrchestrator 是其超集. */
export interface OrchestratorLike {
  runDirector(idea: string): Promise<any>;
  runWriter(plan: any): Promise<any>;
  runStyleBibleArtist?(plan: any): Promise<any>;
  runCharacterDesigner?(characters: any[]): Promise<any>;
  runSceneDesigner?(scenes: any[]): Promise<any>;
  runStoryboardArtist?(script: any, characters: any[], scenes?: any[]): Promise<any>;
  runVideoProducer?(storyboards: any, ...rest: any[]): Promise<any>;
  runEditor?(videos: any, script: any): Promise<any>;
  runDirectorReview?(script: any, videos: any, editResult?: any, storyboards?: any): Promise<any>;
}

/**
 * 按 kind 取上游产出: 先看直接依赖, 再看全部已完成上游 (pipeline 数据共享).
 * 这样 producer 即使只直接依赖 editor, 也能拿到 writer 的 script.
 */
function depOf(ctx: StepContext, kind: StepKind): any {
  const direct = ctx.depOutputs.find((d) => d.kind === kind)?.output;
  if (direct !== undefined) return direct;
  return ctx.upstreamByKind?.[kind];
}

/**
 * 构造 9 个 kind → StepRunner 的映射, 绑定到给定 orchestrator.
 * orchestrator 没实现某可选方法时, 该 runner 抛清晰错误 (引擎按 onFailure 处理).
 */
export function buildOrchestratorRunners(orch: OrchestratorLike): Record<StepKind, StepRunner> {
  const need = <T>(fn: T | undefined, kind: string): T => {
    if (typeof fn !== 'function') throw new Error(`orchestrator 未实现 ${kind} 所需方法`);
    return fn;
  };

  return {
    director: async (ctx) => {
      const idea = String(ctx.input.idea ?? ctx.input.prompt ?? '');
      if (!idea) throw new Error('director 步骤需要 input.idea');
      return orch.runDirector(idea);
    },
    writer: async (ctx) => {
      const plan = depOf(ctx, 'director');
      if (!plan) throw new Error('writer 步骤缺少 director 产出 (plan)');
      return orch.runWriter(plan);
    },
    style_bible: async (ctx) => {
      const plan = depOf(ctx, 'director');
      return need(orch.runStyleBibleArtist, 'style_bible').call(orch, plan);
    },
    character_designer: async (ctx) => {
      const script = depOf(ctx, 'writer');
      const characters = script?.characters ?? [];
      return need(orch.runCharacterDesigner, 'character_designer').call(orch, characters);
    },
    scene_designer: async (ctx) => {
      const script = depOf(ctx, 'writer');
      const scenes = script?.scenes ?? [];
      return need(orch.runSceneDesigner, 'scene_designer').call(orch, scenes);
    },
    storyboard: async (ctx) => {
      const script = depOf(ctx, 'writer');
      const characters = depOf(ctx, 'character_designer') ?? [];
      const scenes = depOf(ctx, 'scene_designer') ?? [];
      if (!script) throw new Error('storyboard 步骤缺少 writer 产出 (script)');
      return need(orch.runStoryboardArtist, 'storyboard').call(orch, script, characters, scenes);
    },
    video_producer: async (ctx) => {
      const storyboards = depOf(ctx, 'storyboard');
      if (!storyboards) throw new Error('video_producer 步骤缺少 storyboard 产出');
      return need(orch.runVideoProducer, 'video_producer').call(orch, storyboards);
    },
    editor: async (ctx) => {
      const videos = depOf(ctx, 'video_producer');
      const script = depOf(ctx, 'writer');
      return need(orch.runEditor, 'editor').call(orch, videos, script);
    },
    producer: async (ctx) => {
      const script = depOf(ctx, 'writer');
      const videos = depOf(ctx, 'video_producer');
      const editResult = depOf(ctx, 'editor');
      const storyboards = depOf(ctx, 'storyboard');
      return need(orch.runDirectorReview, 'producer').call(orch, script, videos, editResult, storyboards);
    },
    custom: async (ctx) => {
      // 自定义步: 默认透传依赖产出 (用户可在 v4.1.3 注册自己的脚本)
      return { custom: ctx.node.id, passthrough: ctx.depOutputs.map((d) => d.id) };
    },
  };
}

/** 把真 orchestrator 的 runner 注册进引擎 (覆盖 dry-run). */
export function registerOrchestratorRunners(orch: OrchestratorLike): void {
  const runners = buildOrchestratorRunners(orch);
  (Object.keys(runners) as StepKind[]).forEach((kind) => {
    registerStepRunner(kind, runners[kind]);
  });
}
