/**
 * v12.455 —— 整季批量(进程内路径)不许把失败的集写成 completed。
 *
 * 对抗复查挖出:app/api/series/[id]/generate 的进程内路径传空回调给流水线、返回就标 completed。
 * 流水线的失败是「发 error 事件后正常返回」,于是节奏门禁拦下的集被写成「已完成」;
 * 又因为一集就是一个项目、setEpisodeStatus 改的就是 projects.status,
 * 流水线自己如实写下的 failed 也会被覆盖回 completed(v12.433 的诚实状态在这条路径上失效)。
 *
 * 路由用例打真路由(不是只测抽出来的函数):哪天有人把路由改回「空回调 + 返回即完成」,这里会红。
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  statuses: [] as Array<[string, string]>,
  behaviour: {} as Record<string, 'emit-error' | 'ok' | 'throw'>,
  episodes: [] as any[],
}));

vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-series-455' }) }));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: async () => ({ allow: true, guard: {} }) }));
vi.mock('@/lib/repos/series-repo', async (orig) => {
  const m = await orig<Record<string, unknown>>();
  return {
    ...m,
    listSeriesEpisodesFull: async () => h.episodes,
    setEpisodeStatus: async (id: string, status: string) => { h.statuses.push([id, status]); },
  };
});
vi.mock('@/lib/create-pipeline', () => ({
  runCreatePipeline: async (input: { projectId: string }, emit: (t: string, d: unknown) => void) => {
    const b = h.behaviour[input.projectId];
    if (b === 'throw') throw new Error('进程被杀');
    if (b === 'emit-error') {
      emit('error', { message: '剧本节奏审计未通过', code: 'PACING_GATE_BLOCKED', retryable: false, terminal: true });
      return; // 流水线的失败语义:发 error 后正常返回
    }
    emit('complete', { projectId: input.projectId });
  },
}));

import { runSeriesEpisodeOnce } from '@/lib/series-episode-run';
import { POST } from '@/app/api/series/[id]/generate/route';

function recorder() {
  const log: Array<[string, string]> = [];
  return { log, setEpisodeStatus: async (id: string, s: string) => { log.push([id, s]); } };
}

describe('v12.455 · runSeriesEpisodeOnce 与 worker 同一判据', () => {
  it('发过 error → failed 并抛出(批量统计计入失败)', async () => {
    const r = recorder();
    await expect(runSeriesEpisodeOnce('e1', {}, {
      runCreatePipeline: async (_i, emit) => { emit('error', { message: '节奏拦下' }); },
      setEpisodeStatus: r.setEpisodeStatus,
    })).rejects.toThrow('节奏拦下');
    expect(r.log).toEqual([['e1', 'failed']]);
  });
  it('反面 · 没发 error → completed', async () => {
    const r = recorder();
    await runSeriesEpisodeOnce('e2', {}, {
      runCreatePipeline: async (_i, emit) => { emit('status', { message: 'x' }); emit('complete', {}); },
      setEpisodeStatus: r.setEpisodeStatus,
    });
    expect(r.log).toEqual([['e2', 'completed']]);
  });
  it('抛异常 → 保持原行为回退 draft 并重抛', async () => {
    const r = recorder();
    await expect(runSeriesEpisodeOnce('e3', {}, {
      runCreatePipeline: async () => { throw new Error('boom'); },
      setEpisodeStatus: r.setEpisodeStatus,
    })).rejects.toThrow('boom');
    expect(r.log).toEqual([['e3', 'draft']]);
  });
});

describe('v12.455 · 整季路由进程内路径', { timeout: 60_000 }, () => {
  it('被拦的集记 failed、正常的记 completed、抛异常的回退 draft', async () => {
    const prevQueue = process.env.PIPELINE_QUEUE;
    delete process.env.PIPELINE_QUEUE; // 走进程内 runPool 路径
    h.statuses.length = 0;
    h.episodes = ['ep-block', 'ep-ok', 'ep-throw'].map((id, i) => ({
      id, episode_number: i + 1, status: 'draft', title: `第${i + 1}集`, premise: '都市复仇短剧',
      aspect: '9:16', style_id: null, primary_character_ref: null, locked_characters: '[]',
    }));
    h.behaviour = { 'ep-block': 'emit-error', 'ep-ok': 'ok', 'ep-throw': 'throw' };
    try {
      const res = await POST(new Request('http://localhost/api/series/s-455/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }), { params: Promise.resolve({ id: 's-455' }) });
      expect(res.status).toBe(200);
      // 后台 fire-and-forget:等三集都落到终态
      const final = () => Object.fromEntries(h.statuses.filter(([, s]) => s !== 'active'));
      for (let i = 0; i < 100 && Object.keys(final()).length < 3; i++) await new Promise((r) => setTimeout(r, 50));
      const f = final();
      expect(f['ep-block']).toBe('failed');
      expect(f['ep-ok']).toBe('completed');
      expect(f['ep-throw']).toBe('draft');
      // 先标 active(前端轮询立即看到「生成中」)这一原行为没丢
      expect(h.statuses.filter(([, s]) => s === 'active').length).toBe(3);
    } finally {
      if (prevQueue === undefined) delete process.env.PIPELINE_QUEUE; else process.env.PIPELINE_QUEUE = prevQueue;
    }
  });
});
