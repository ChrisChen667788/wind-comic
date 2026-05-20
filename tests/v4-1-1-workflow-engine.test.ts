/**
 * v4.1.1 — Workflow 执行引擎单测 (mock runner).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import {
  executeWorkflow,
  registerStepRunner,
  clearStepRunners,
  listRegisteredStepKinds,
  type StepContext,
} from '@/lib/workflow-engine';
import type { WorkflowGraph, StepKind } from '@/lib/agent-workflow';

const wf = (nodes: WorkflowGraph['nodes']): WorkflowGraph => ({ id: 'wf_' + nanoid(6), name: 'WF', nodes });

beforeEach(() => clearStepRunners());

// 把所有用到的 kind 都注册成一个 echo runner
function registerEcho(order: string[]) {
  const kinds: StepKind[] = ['director', 'writer', 'style_bible', 'storyboard', 'editor', 'producer', 'custom', 'character_designer', 'scene_designer', 'video_producer'];
  for (const k of kinds) {
    registerStepRunner(k, async (ctx: StepContext) => {
      order.push(ctx.node.id);
      return { ran: ctx.node.id, deps: ctx.node.dependsOn };
    });
  }
}

describe('v4.1.1 · executeWorkflow — happy path', () => {
  it('runs all steps, outputs keyed by node id', async () => {
    const order: string[] = [];
    registerEcho(order);
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
      { id: 'p', kind: 'producer', label: 'p', dependsOn: ['w'] },
    ]);
    const r = await executeWorkflow(g);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.outputs).sort()).toEqual(['d', 'p', 'w']);
    expect(order).toEqual(['d', 'w', 'p']); // 拓扑顺序
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
  });

  it('passes dependency outputs into downstream context', async () => {
    clearStepRunners();
    registerStepRunner('director', async () => ({ plan: 'PLAN-X' }));
    let seen: any = null;
    registerStepRunner('writer', async (ctx) => { seen = ctx.outputs['d']; return { script: 'S' }; });
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
    ]);
    await executeWorkflow(g);
    expect(seen).toEqual({ plan: 'PLAN-X' });
  });

  it('runs same-level nodes (both present in outputs)', async () => {
    const order: string[] = [];
    registerEcho(order);
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
      { id: 's', kind: 'style_bible', label: 's', dependsOn: ['d'] },
    ]);
    const r = await executeWorkflow(g);
    expect(r.outputs).toHaveProperty('w');
    expect(r.outputs).toHaveProperty('s');
    expect(order[0]).toBe('d'); // director first
  });

  it('passes workflow-level input through', async () => {
    let gotInput: any = null;
    registerStepRunner('director', async (ctx) => { gotInput = ctx.input; return {}; });
    const g = wf([{ id: 'd', kind: 'director', label: 'd', dependsOn: [] }]);
    await executeWorkflow(g, { input: { idea: '一个武侠故事' } });
    expect(gotInput).toEqual({ idea: '一个武侠故事' });
  });
});

describe('v4.1.1 · executeWorkflow — failures', () => {
  it('missing runner → step failed', async () => {
    // 不注册任何 runner
    const g = wf([{ id: 'd', kind: 'director', label: 'd', dependsOn: [] }]);
    const r = await executeWorkflow(g);
    expect(r.ok).toBe(false);
    expect(r.steps[0].status).toBe('failed');
    expect(r.steps[0].error).toContain('runner');
  });

  it('abort mode: failure stops downstream (skipped)', async () => {
    registerStepRunner('director', async () => { throw new Error('boom'); });
    registerStepRunner('writer', async () => ({ ok: 1 }));
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
    ]);
    const r = await executeWorkflow(g, { onFailure: 'abort' });
    expect(r.ok).toBe(false);
    const byId = Object.fromEntries(r.steps.map((s) => [s.nodeId, s.status]));
    expect(byId.d).toBe('failed');
    expect(byId.w).toBe('skipped');
  });

  it('continue mode: downstream of failure skipped, independent branch runs', async () => {
    registerStepRunner('director', async () => ({ plan: 1 }));
    registerStepRunner('writer', async () => { throw new Error('writer-fail'); });
    registerStepRunner('style_bible', async () => ({ style: 1 }));
    registerStepRunner('storyboard', async () => ({ board: 1 }));
    // d → w → board (board skipped); d → s (runs)
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
      { id: 's', kind: 'style_bible', label: 's', dependsOn: ['d'] },
      { id: 'board', kind: 'storyboard', label: 'b', dependsOn: ['w'] },
    ]);
    const r = await executeWorkflow(g, { onFailure: 'continue' });
    expect(r.ok).toBe(false); // 有 failed
    const byId = Object.fromEntries(r.steps.map((s) => [s.nodeId, s.status]));
    expect(byId.d).toBe('done');
    expect(byId.w).toBe('failed');
    expect(byId.s).toBe('done');     // 独立分支照跑
    expect(byId.board).toBe('skipped'); // 依赖 w
  });

  it('invalid workflow → ok:false with error', async () => {
    const g = wf([{ id: 'a', kind: 'director', label: 'a', dependsOn: ['a'] }]); // self-dep
    const r = await executeWorkflow(g);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.steps).toHaveLength(0);
  });

  it('fires onStep callbacks', async () => {
    const events: string[] = [];
    registerStepRunner('director', async () => ({ ok: 1 }));
    registerStepRunner('writer', async () => { throw new Error('x'); });
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
    ]);
    await executeWorkflow(g, {
      onStepStart: (id) => events.push('start:' + id),
      onStepDone: (id) => events.push('done:' + id),
      onStepError: (id) => events.push('err:' + id),
    });
    expect(events).toContain('start:d');
    expect(events).toContain('done:d');
    expect(events).toContain('err:w');
  });
});

describe('v4.1.1 · builtins (dry-run)', () => {
  it('registering builtins covers all catalog kinds', async () => {
    clearStepRunners();
    const mod = await import('@/lib/workflow-builtins');
    mod.registerBuiltinStepRunners();
    const kinds = listRegisteredStepKinds();
    expect(kinds).toContain('director');
    expect(kinds).toContain('producer');
    expect(kinds).toContain('custom');
  });

  it('default workflow executes end-to-end in dry-run', async () => {
    clearStepRunners();
    const { registerBuiltinStepRunners } = await import('@/lib/workflow-builtins');
    registerBuiltinStepRunners();
    const { defaultWorkflow } = await import('@/lib/agent-workflow');
    const r = await executeWorkflow(defaultWorkflow(), { input: { idea: 'x' } });
    expect(r.ok).toBe(true);
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
    // producer 的 dry-run 输出标了 dryRun
    expect((r.outputs['producer'] as any)?.dryRun).toBe(true);
  });
});
