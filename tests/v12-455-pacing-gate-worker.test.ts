/**
 * v12.455 —— 队列路径:节奏门禁拦下的任务不能被 worker 当成「临时故障」反复重试。
 *
 * worker 靠「流水线有没有发过 error」判失败,失败默认按次数重试(MAX_ATTEMPTS=3)。
 * 节奏门禁拦下后,续跑装载的还是同一份剧本、会被同一个判据再拦一次 —— 重试纯属白跑。
 * 所以拦截事件带 terminal:true,worker 见到就直接判终态。
 *
 * 反面同样要验:欠费之类的错误早就带 retryable:false(语义是「能否只重试这一步」),
 * 它们**不能**因为这次改动被顺手改成不重试 —— 所以 worker 只认 terminal,不认 retryable。
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ payloadKind: {} as Record<string, 'terminal' | 'plain'>, lastInput: null as any }));

vi.mock('@/lib/create-pipeline', () => ({
  runCreatePipeline: async (input: { projectId: string }, emit: (t: string, d: unknown) => void) => {
    h.lastInput = input;
    if (!(input.projectId in h.payloadKind)) return; // 接口透传用例:只记参数,不发事件
    emit('error', h.payloadKind[input.projectId] === 'terminal'
      ? { message: '节奏拦下', code: 'PACING_GATE_BLOCKED', retryable: false, terminal: true }
      : { message: '上游欠费', code: 'PROVIDER_ARREARS', retryable: false });
  },
}));

vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-pg455' }) }));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: async () => ({ allow: true, guard: {} }) }));

import { enqueuePipelineJob, getPipelineJob, failJob } from '@/lib/repos/pipeline-job-repo';
import { POST as createStream } from '@/app/api/create-stream/route';
import { ensurePipelineWorker } from '@/lib/pipeline-worker';

const g = globalThis as unknown as { __qfmjPipelineWorker?: { timer: ReturnType<typeof setInterval> } };
afterAll(() => {
  // 本仓测试同进程串行(singleFork):worker 单例挂在 globalThis 上,不清掉会留到后面的测试文件里
  if (g.__qfmjPipelineWorker) { clearInterval(g.__qfmjPipelineWorker.timer); delete g.__qfmjPipelineWorker; }
});

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('v12.455 · failJob 的 terminal 选项', () => {
  it('terminal:true → 第一次失败就进终态', async () => {
    const job = await enqueuePipelineJob({ type: 'noop-test', projectId: 'pg455-repo-a', payload: {} });
    expect(await failJob(job.id, 'x', { terminal: true })).toBe('failed');
  });
  it('反面 · 不带选项仍按次数重试(老调用方行为不变)', async () => {
    const job = await enqueuePipelineJob({ type: 'noop-test', projectId: 'pg455-repo-b', payload: {} });
    expect(await failJob(job.id, 'x')).toBe('queued');
  });
});

describe('v12.455 · worker 真跑', () => {
  it('节奏拦下(terminal:true)→ 只跑一次就 failed,不重试', async () => {
    h.payloadKind['pg455-w-terminal'] = 'terminal';
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'pg455-w-terminal', userId: null, payload: { projectId: 'pg455-w-terminal' } });
    ensurePipelineWorker();
    const done = await waitFor(() => getPipelineJob(job.id), (j) => j?.state === 'failed');
    expect(done?.state).toBe('failed');
    expect(done?.attempts).toBe(1);
    expect(done?.lastError).toContain('节奏拦下');
  }, 20_000);

  it('反面 · 欠费(retryable:false 但没有 terminal)照旧重试', async () => {
    h.payloadKind['pg455-w-plain'] = 'plain';
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'pg455-w-plain', userId: null, payload: { projectId: 'pg455-w-plain' } });
    ensurePipelineWorker();
    const retried = await waitFor(() => getPipelineJob(job.id), (j) => (j?.attempts ?? 0) >= 2);
    expect(retried?.attempts).toBeGreaterThanOrEqual(2);
  }, 20_000);
});

describe('v12.455 · 创作接口把门禁字段透传给流水线', () => {
  const IDEA = '一个关于背叛与复仇的都市短剧:女主在订婚宴上当众揭穿未婚夫和闺蜜联手侵吞家族企业的阴谋';
  async function post(body: Record<string, unknown>) {
    const prev = process.env.MOCK_ENGINES;
    process.env.MOCK_ENGINES = '1'; // 跳过创意的 LLM 扩写,零外部调用
    h.lastInput = null;
    try {
      const res = await createStream(new Request('http://localhost/api/create-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: IDEA, ...body }),
      }) as any);
      const reader = (res as Response).body!.getReader();
      for (;;) { const { done } = await reader.read(); if (done) break; }
    } finally {
      if (prev === undefined) delete process.env.MOCK_ENGINES; else process.env.MOCK_ENGINES = prev;
    }
    return h.lastInput;
  }
  it('pacingGate / pacingOverride 原样到达流水线', async () => {
    const input = await post({ pacingGate: 'block', pacingOverride: true });
    expect(input).toBeTruthy();
    expect(input.pacingGate).toBe('block');
    expect(input.pacingOverride).toBe(true);
  });
  it('pacingOverride 只认字面 true;pacingGate 非字符串丢弃', async () => {
    const input = await post({ pacingGate: 7, pacingOverride: 'true' });
    expect(input).toBeTruthy();
    expect(input.pacingGate).toBeUndefined();
    expect(input.pacingOverride).toBe(false);
  });
});
