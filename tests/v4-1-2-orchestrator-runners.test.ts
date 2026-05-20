/**
 * v4.1.2 — orchestrator runner 适配器单测 (mock orchestrator, 不跑真 pipeline).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import {
  buildOrchestratorRunners,
  registerOrchestratorRunners,
  type OrchestratorLike,
} from '@/lib/workflow-orchestrator-runners';
import { executeWorkflow, clearStepRunners } from '@/lib/workflow-engine';
import { defaultWorkflow, type WorkflowGraph } from '@/lib/agent-workflow';

beforeEach(() => clearStepRunners());

// 全实现的 mock orchestrator: 每步回显输入, 方便断言数据流
function mockOrch(calls: string[] = []): OrchestratorLike {
  return {
    runDirector: async (idea) => { calls.push('director:' + idea); return { plan: 'PLAN(' + idea + ')' }; },
    runWriter: async (plan) => { calls.push('writer'); return { script: 'SCRIPT', from: plan, characters: [{ name: '甲' }], scenes: [{ id: 's1' }] }; },
    runStyleBibleArtist: async () => { calls.push('style'); return 'STYLE_URL'; },
    runCharacterDesigner: async (chars) => { calls.push('char:' + chars.length); return chars.map((c: any) => ({ ...c, designed: true })); },
    runSceneDesigner: async (scenes) => { calls.push('scene:' + scenes.length); return scenes.map((s: any) => ({ ...s, designed: true })); },
    runStoryboardArtist: async (script, chars, scenes) => { calls.push('board'); return [{ shot: 1, script: !!script, chars: chars.length, scenes: (scenes || []).length }]; },
    runVideoProducer: async (boards) => { calls.push('video'); return [{ video: 1, fromBoards: boards.length }]; },
    runEditor: async (videos, script) => { calls.push('editor'); return { cut: 'final.mp4', videos: videos.length, script: !!script }; },
    runDirectorReview: async (script, videos, edit, boards) => { calls.push('review'); return { ok: true, hasAll: !!script && !!videos && !!edit && !!boards }; },
  };
}

describe('v4.1.2 · buildOrchestratorRunners', () => {
  it('director runner calls runDirector with input.idea', async () => {
    const calls: string[] = [];
    registerOrchestratorRunners(mockOrch(calls));
    const g: WorkflowGraph = { id: 'wf_' + nanoid(6), name: 'W', nodes: [
      { id: 'director', kind: 'director', label: 'd', dependsOn: [] },
    ]};
    const r = await executeWorkflow(g, { input: { idea: '武侠故事' } });
    expect(r.ok).toBe(true);
    expect(calls).toContain('director:武侠故事');
    expect((r.outputs['director'] as any).plan).toBe('PLAN(武侠故事)');
  });

  it('writer pulls plan from director dep output (by kind, not id)', async () => {
    registerOrchestratorRunners(mockOrch());
    const g: WorkflowGraph = { id: 'wf_' + nanoid(6), name: 'W', nodes: [
      { id: 'D', kind: 'director', label: 'd', dependsOn: [] },     // arbitrary id
      { id: 'W', kind: 'writer', label: 'w', dependsOn: ['D'] },
    ]};
    const r = await executeWorkflow(g, { input: { idea: 'x' } });
    expect(r.ok).toBe(true);
    expect((r.outputs['W'] as any).from).toEqual({ plan: 'PLAN(x)' });
  });

  it('full default workflow runs end-to-end through mock orchestrator', async () => {
    const calls: string[] = [];
    registerOrchestratorRunners(mockOrch(calls));
    const r = await executeWorkflow(defaultWorkflow(), { input: { idea: '都市爱情' } });
    expect(r.ok).toBe(true);
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
    // producer 拿到了全部上游 (script/videos/edit/boards)
    expect((r.outputs['producer'] as any).hasAll).toBe(true);
    // 调用顺序合理: director 在 writer 之前, board 在 video 之前
    expect(calls.indexOf('director:都市爱情')).toBeLessThan(calls.indexOf('writer'));
    expect(calls.indexOf('board')).toBeLessThan(calls.indexOf('video'));
  });

  it('writer without director dep → step fails', async () => {
    registerOrchestratorRunners(mockOrch());
    const g: WorkflowGraph = { id: 'wf_' + nanoid(6), name: 'W', nodes: [
      { id: 'W', kind: 'writer', label: 'w', dependsOn: [] },
    ]};
    const r = await executeWorkflow(g);
    expect(r.ok).toBe(false);
    expect(r.steps[0].error).toContain('director 产出');
  });

  it('missing optional method → clear error', async () => {
    const partial: OrchestratorLike = {
      runDirector: async () => ({ plan: 1 }),
      runWriter: async () => ({ script: 1 }),
      // 不实现 runStyleBibleArtist
    };
    const runners = buildOrchestratorRunners(partial);
    await expect(
      runners.style_bible({ node: { id: 's', kind: 'style_bible', label: 's', dependsOn: ['d'] }, input: {}, outputs: {}, depOutputs: [{ id: 'd', kind: 'director', output: { plan: 1 } }] }),
    ).rejects.toThrow(/未实现/);
  });

  it('custom step passes through dep ids', async () => {
    const runners = buildOrchestratorRunners(mockOrch());
    const out: any = await runners.custom({
      node: { id: 'c', kind: 'custom', label: 'c', dependsOn: ['a', 'b'] },
      input: {}, outputs: {}, depOutputs: [{ id: 'a', kind: 'director', output: 1 }, { id: 'b', kind: 'writer', output: 2 }],
    });
    expect(out.passthrough).toEqual(['a', 'b']);
  });
});
