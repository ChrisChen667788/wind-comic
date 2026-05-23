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

describe('v4.1.4 · runWorkflowReal 落盘 project', () => {
  it('persists a workflow-run asset when projectId given', async () => {
    const { db, now } = await import('@/lib/db');
    const { countProjectAssets, listAssetsByType } = await import('@/lib/repos/asset-repo');
    const { nanoid } = await import('nanoid');
    // 建真 user + project (FK)
    const uid = 'u-' + nanoid();
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(uid, `${uid}@test.local`, 'x', uid, now());
    const pid = 'proj-' + nanoid();
    db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 'wf', '', '[]', 'draft', ?, ?)`)
      .run(pid, uid, now(), now());

    const before = await countProjectAssets(pid);
    const r = await runWorkflowReal(defaultWorkflow(), { idea: '都市', projectId: pid }, mockOrch());
    expect(r.ok).toBe(true);
    const after = await countProjectAssets(pid);
    expect(after).toBe(before + 1);
    const runs = await listAssetsByType(pid, 'workflow-run');
    expect(runs.length).toBe(1);
    expect(JSON.parse(runs[0].data).ok).toBe(true);
  });

  it('no projectId → no persist (just returns result)', async () => {
    const r = await runWorkflowReal(defaultWorkflow(), { idea: 'x' }, mockOrch());
    expect(r.ok).toBe(true); // 不抛, 正常返回
  });
});

describe('v4.1.5 · runWorkflowReal hooks (SSE 进度回调)', () => {
  it('fires onStepStart/onStepDone for each node', async () => {
    const starts: string[] = [];
    const dones: string[] = [];
    const r = await runWorkflowReal(
      defaultWorkflow(),
      { idea: 'x' },
      mockOrch(),
      {
        onStepStart: (nodeId) => starts.push(nodeId),
        onStepDone: (nodeId) => dones.push(nodeId),
      },
    );
    expect(r.ok).toBe(true);
    // 默认流水线 9 步全部 start + done
    expect(starts.length).toBe(9);
    expect(dones.length).toBe(9);
    expect(starts).toContain('director');
    expect(dones).toContain('producer');
  });

  it('fires onStepError when a step fails', async () => {
    const errs: Array<{ id: string; e: string }> = [];
    const orch = mockOrch();
    orch.runWriter = async () => { throw new Error('writer-boom'); };
    const r = await runWorkflowReal(
      defaultWorkflow(),
      { idea: 'x' },
      orch,
      { onStepError: (nodeId, e) => errs.push({ id: nodeId, e }) },
    );
    expect(r.ok).toBe(false);
    expect(errs.some((x) => x.e.includes('writer-boom'))).toBe(true);
  });
});
