/**
 * v12.448 · 「整阶段重做视频」路径漏设项目号(对抗复查挖出)。
 *
 * /api/regenerate-shot 的 stage=video 分支走 runVideoProducer,它读的是编排器身上的项目号;
 * 路由从没 setProjectId,于是导演台站位(v12.440)与参考视频(v12.448)在这条路径上都被静默跳过。
 * 用记录调用顺序的假编排器真跑路由:项目号必须在出片**之前**设上,且是请求里的那个。
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));

vi.mock('@/services/hybrid-orchestrator', () => {
  class HybridOrchestrator {
    onProgress: unknown = null;
    setProjectId(id: string) { h.calls.push(['setProjectId', id]); }
    setUserStyle() {}
    setPrimaryCharacterRef() {}
    setLockedCharacters() {}
    async runVideoProducer() { h.calls.push(['runVideoProducer', null]); return []; }
    async regenerateShot() { h.calls.push(['regenerateShot', null]); return { videoUrl: '' }; }
  }
  return { HybridOrchestrator };
});
vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: async () => ({ ok: true, userId: 'u1' }) }));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: async () => ({ allow: true, guard: {} }) }));

import { POST } from '@/app/api/regenerate-shot/route';

async function drain(res: Response) {
  const reader = res.body!.getReader();
  for (;;) { const { done } = await reader.read(); if (done) break; }
}

describe('v12.448 · 整阶段重做视频要带上项目号', () => {
  it('setProjectId 在 runVideoProducer 之前,且是请求里的项目号', async () => {
    h.calls.length = 0;
    const res = await POST(new Request('http://localhost/api/regenerate-shot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-stage-video', stage: 'video', videoProvider: 'minimax' }),
    }) as any);
    await drain(res as Response);
    const names = h.calls.map(([n]) => n);
    expect(names).toContain('runVideoProducer');
    const setAt = names.indexOf('setProjectId');
    expect(setAt, '整阶段重做从没设项目号 —— 站位与参考视频都会被跳过').toBeGreaterThanOrEqual(0);
    expect(setAt).toBeLessThan(names.indexOf('runVideoProducer'));
    expect(h.calls[setAt][1]).toBe('proj-stage-video');
  }, 60000);
});
