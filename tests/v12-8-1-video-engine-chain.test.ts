/**
 * v12.8.1 — 视频引擎兜底链 + 真实软熔断 集成测试。
 *
 * 坐实 orchestrator 视频循环的「跨镜跳过冷却引擎」:这里用的就是 orchestrator 调的
 * 同一个 runVideoEngineChain + 同一个 provider-health-cache(isProviderHealthy /
 * markProviderDownIfFatal),只把每个引擎的具体调用换成测试桩。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runVideoEngineChain } from '@/lib/video-engine-chain';
import { isProviderHealthy, markProviderDownIfFatal, clearProviderHealth } from '@/lib/provider-health-cache';

const deps = () => ({
  isHealthy: isProviderHealthy,            // ← orchestrator 用的真实函数
  markFatal: markProviderDownIfFatal,      // ← 同上
  isValidUrl: (u: string) => !!u && u.startsWith('http'),
});

describe('v12.8.1 · runVideoEngineChain + 真实软熔断', () => {
  beforeEach(() => { clearProviderHealth(); vi.useRealTimers(); });
  afterEach(() => vi.useRealTimers());

  it('引擎饱和失败 → 落下一个引擎成功,并熔断它', async () => {
    const r = await runVideoEngineChain(['veo', 'minimax', 'kling'], async (e) => {
      if (e === 'veo') throw new Error('pre_consume_token_quota_failed 分组饱和');
      return `http://cdn/${e}.mp4`;
    }, deps());
    expect(r.engine).toBe('minimax');
    expect(r.videoUrl).toBe('http://cdn/minimax.mp4');
    expect(isProviderHealthy('veo')).toBe(false); // veo 已被熔断
  });

  it('★坐实:veo 冷却中 → 下一镜直接跳过 veo,不再打它', async () => {
    // 第 1 镜:veo 饱和 → 熔断
    await runVideoEngineChain(['veo', 'minimax', 'kling'], async (e) => {
      if (e === 'veo') throw new Error('分组饱和');
      return `http://cdn/${e}.mp4`;
    }, deps());

    // 第 2 镜:veo 仍在冷却 —— attempt 回调绝不该收到 'veo'
    const attempted: string[] = [];
    const r2 = await runVideoEngineChain(['veo', 'minimax', 'kling'], async (e) => {
      attempted.push(e);
      return `http://cdn/${e}.mp4`;
    }, deps());

    expect(attempted).not.toContain('veo'); // ← 没再打 veo(此前是每镜都重打)
    expect(r2.skipped).toContain('veo');
    expect(r2.engine).toBe('minimax');
  });

  it('TTL 过期 → veo 恢复,下一镜重新优先尝试', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    await runVideoEngineChain(['veo', 'minimax'], async (e) => {
      if (e === 'veo') throw new Error('分组饱和');
      return `http://cdn/${e}.mp4`;
    }, deps());
    expect(isProviderHealthy('veo')).toBe(false);

    vi.setSystemTime(6 * 60 * 1000); // 过 5min 冷却
    const attempted: string[] = [];
    await runVideoEngineChain(['veo', 'minimax'], async (e) => { attempted.push(e); return `http://cdn/${e}.mp4`; }, deps());
    expect(attempted[0]).toBe('veo'); // veo 恢复,首选再试
  });

  it('非致命错误(超时)→ 不熔断,下一镜仍会试 veo', async () => {
    await runVideoEngineChain(['veo', 'minimax'], async (e) => {
      if (e === 'veo') throw new Error('ETIMEDOUT request timeout');
      return `http://cdn/${e}.mp4`;
    }, deps());
    expect(isProviderHealthy('veo')).toBe(true); // 超时不冤枉它
  });

  it('全部引擎失败 → engine=null,videoUrl 空(上层走降级)', async () => {
    const r = await runVideoEngineChain(['veo', 'minimax'], async () => { throw new Error('boom'); }, deps());
    expect(r.engine).toBeNull();
    expect(r.videoUrl).toBe('');
  });

  it('引擎返回无效 URL → 当失败处理,落下一个引擎', async () => {
    const r = await runVideoEngineChain(['veo', 'minimax'], async (e) => (e === 'veo' ? 'not-a-url' : 'http://cdn/minimax.mp4'), deps());
    expect(r.engine).toBe('minimax');
  });
});
