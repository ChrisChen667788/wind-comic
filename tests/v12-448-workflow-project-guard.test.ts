/**
 * v12.448 · 工作流执行的 projectId(对抗复查第二轮挖出)。
 *
 * ① 执行路由从不校验 input.projectId 归属 —— 真跑会把结果写进这个项目(v4.1.4 起),
 *    任何登录用户填别人的项目号就能越权写。带了就必须有编辑权限。
 * ② 执行器只把项目号放进工作流输入,没交给编排器 —— runVideoProducer 读编排器身上的项目号,
 *    导演台站位与参考视频在真跑模式下都被静默跳过。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWorkflowReal } from '@/lib/workflow-real-runner';
import { defaultWorkflow } from '@/lib/agent-workflow-core';
import type { OrchestratorLike } from '@/lib/workflow-orchestrator-runners';

const m = vi.hoisted(() => ({ access: { ok: true } as any, checked: [] as string[], modes: [] as string[], ran: [] as any[] }));

vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u1' }) }));
vi.mock('@/lib/agent-workflow', async (orig) => ({
  ...(await orig() as any),
  getWorkflow: async () => ({ id: 'wf1', userId: 'u1', graph: { id: 'wf1', name: 'W', nodes: [] } }),
}));
vi.mock('@/lib/auth-guard', () => ({
  requireProjectAccess: async (_r: unknown, pid: string, mode: string) => { m.checked.push(pid); m.modes.push(mode); return m.access; },
}));
vi.mock('@/lib/workflow-real-runner', async (orig) => ({
  ...(await orig() as any),
  checkRealRunCapability: () => ({ llm: true }),
  runWorkflowReal: async (_g: unknown, input: any) => { m.ran.push(input); return { mode: 'real', ok: true, outputs: {}, steps: [] }; },
}));

beforeEach(() => { m.access = { ok: true }; m.checked = []; m.modes = []; m.ran = []; });

const post = (body: unknown) => new Request('http://localhost/api/workflows/wf1/execute', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ id: 'wf1' }) };

async function drain(res: Response) {
  if (!res.body) return;
  const r = res.body.getReader();
  for (;;) { const { done } = await r.read(); if (done) break; }
}

describe('v12.448 · 执行路由校验 input.projectId 归属', () => {
  for (const [label, path] of [['非流式', '@/app/api/workflows/[id]/execute/route'], ['流式', '@/app/api/workflows/[id]/execute/stream/route']] as const) {
    it(`${label}:别人的项目 → 403,不执行`, async () => {
      m.access = { ok: false, status: 403, message: 'Forbidden' };
      const { POST } = await import(path);
      const res = await POST(post({ mode: 'real', input: { idea: 'x', projectId: 'victim-proj' } }), params);
      expect(res.status).toBe(403);
      expect(m.checked).toEqual(['victim-proj']);
      expect(m.ran).toEqual([]);
    });
    it(`${label}:自己的项目 → 照常执行,项目号传下去`, async () => {
      const { POST } = await import(path);
      const res = await POST(post({ mode: 'real', input: { idea: 'x', projectId: 'my-proj' } }), params);
      await drain(res);
      expect(m.checked).toEqual(['my-proj']);
      expect(m.modes).toEqual(['edit']); // 真跑会写进项目 —— 只读权限不够
      expect(m.ran.map((i) => i.projectId)).toEqual(['my-proj']);
    });
    it(`${label}:没带项目号 → 不查归属,照常执行`, async () => {
      const { POST } = await import(path);
      await drain(await POST(post({ mode: 'real', input: { idea: 'x' } }), params));
      expect(m.checked).toEqual([]);
      expect(m.ran).toHaveLength(1);
    });
  }
});

describe('v12.448 · 执行器把项目号交给编排器', () => {
  const orch = (calls: string[]): OrchestratorLike => ({
    setProjectId: (id: string) => { calls.push('setProjectId:' + id); },
    runDirector: async () => { calls.push('director'); return { plan: 'P' }; },
    runWriter: async () => ({ script: 'S', characters: [], scenes: [] }),
    runStyleBibleArtist: async () => 'STYLE',
    runCharacterDesigner: async () => [],
    runSceneDesigner: async () => [],
    runStoryboardArtist: async () => [{ shot: 1 }],
    runVideoProducer: async () => { calls.push('video'); return [{ v: 1 }]; },
    runEditor: async () => ({ cut: 'final' }),
    runDirectorReview: async () => ({ ok: true }),
  });
  it('带了项目号:在任何阶段之前设到编排器上', async () => {
    const { runWorkflowReal: real } = await vi.importActual<typeof import('@/lib/workflow-real-runner')>('@/lib/workflow-real-runner');
    const calls: string[] = [];
    await real(defaultWorkflow(), { idea: '武侠', projectId: 'p-9' }, orch(calls));
    expect(calls[0]).toBe('setProjectId:p-9');
    expect(calls).toContain('video');
  });
  it('没带项目号:不设', async () => {
    const { runWorkflowReal: real } = await vi.importActual<typeof import('@/lib/workflow-real-runner')>('@/lib/workflow-real-runner');
    const calls: string[] = [];
    await real(defaultWorkflow(), { idea: '武侠' }, orch(calls));
    expect(calls.some((c) => c.startsWith('setProjectId'))).toBe(false);
  });
});

void runWorkflowReal;
