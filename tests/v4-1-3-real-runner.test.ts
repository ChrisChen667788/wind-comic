/**
 * v4.1.3 — 真 orchestrator 运行单测 (注入 mock orchestrator, 不跑真 pipeline / 不需 key).
 */

import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { runWorkflowReal } from '@/lib/workflow-real-runner';
import { defaultWorkflow, type WorkflowGraph } from '@/lib/agent-workflow-core';
import type { OrchestratorLike } from '@/lib/workflow-orchestrator-runners';

function mockOrch(calls: string[] = []): OrchestratorLike {
  return {
    runDirector: async (idea) => { calls.push('director'); return { plan: 'P:' + idea }; },
    runWriter: async (plan) => { calls.push('writer'); return { script: 'S', from: plan, characters: [], scenes: [] }; },
    runStyleBibleArtist: async () => { calls.push('style'); return 'STYLE'; },
    runCharacterDesigner: async () => { calls.push('char'); return []; },
    runSceneDesigner: async () => { calls.push('scene'); return []; },
    runStoryboardArtist: async () => { calls.push('board'); return [{ shot: 1 }]; },
    runVideoProducer: async () => { calls.push('video'); return [{ v: 1 }]; },
    runEditor: async () => { calls.push('editor'); return { cut: 'final' }; },
    runDirectorReview: async () => { calls.push('review'); return { ok: true }; },
  };
}

describe('v4.1.3 · runWorkflowReal (injected mock orchestrator)', () => {
  it('runs default workflow against orchestrator, marks mode=real', async () => {
    const calls: string[] = [];
    const r = await runWorkflowReal(defaultWorkflow(), { idea: '武侠', projectId: 'p1' }, mockOrch(calls));
    expect(r.mode).toBe('real');
    expect(r.ok).toBe(true);
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
    expect(calls).toContain('director');
    expect(calls).toContain('review');
  });

  it('passes idea into director', async () => {
    const g: WorkflowGraph = { id: 'wf_' + nanoid(6), name: 'W', nodes: [
      { id: 'director', kind: 'director', label: 'd', dependsOn: [] },
    ]};
    const r = await runWorkflowReal(g, { idea: '科幻悬疑' }, mockOrch());
    expect((r.outputs['director'] as any).plan).toBe('P:科幻悬疑');
  });

  it('rejects empty idea', async () => {
    const r = await runWorkflowReal(defaultWorkflow(), { idea: '   ' }, mockOrch());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('idea');
  });

  it('per-call runners do not leak into global registry', async () => {
    // 跑完真实运行后, 全局 dry-run runner 不应被 mock 覆盖
    const { clearStepRunners, getStepRunner } = await import('@/lib/workflow-engine');
    clearStepRunners();
    await runWorkflowReal(defaultWorkflow(), { idea: 'x' }, mockOrch());
    // 全局注册表仍为空 (runWorkflowReal 用 per-call runners, 没注册全局)
    expect(getStepRunner('director')).toBeUndefined();
  });

  it('does NOT require LLM key when orchestrator injected', async () => {
    // 注入 orch 时跳过能力门 — 测试环境没 key 也能跑
    const r = await runWorkflowReal(defaultWorkflow(), { idea: 'x' }, mockOrch());
    expect(r.ok).toBe(true);
  });
});

describe('v4.1.3 · checkRealRunCapability', () => {
  it('returns a capability shape', async () => {
    const { checkRealRunCapability } = await import('@/lib/workflow-real-runner');
    const cap = checkRealRunCapability();
    expect(typeof cap.llm).toBe('boolean');
  });
});
