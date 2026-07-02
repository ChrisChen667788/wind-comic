/**
 * v12.61 — P0-2 健康/延迟感知兜底路由:同网关备用模型链 + LLM 健康缓存。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildLLMAttempts } from '@/lib/llm-client';
import { markLLMDown, isLLMDown, filterHealthyAttempts, llmKey, _resetLLMHealth } from '@/lib/llm-health';

const CFG = {
  baseURL: 'https://gw/v1', apiKey: 'k-main', model: 'sonnet-4',
  creativeBaseURL: 'https://gw/v1', creativeApiKey: 'k-main', creativeModel: 'opus-4',
  altModels: ['sonnet-4-6', 'opus-4-8'],
  fallbackBaseURL: 'https://minimax/v1', fallbackApiKey: 'k-mmx', fallbackModel: 'MiniMax-M3',
} as any;

describe('v12.61 · P0-2 兜底链 + 健康缓存', () => {
  beforeEach(() => _resetLLMHealth());

  it('buildLLMAttempts:主 → 同网关备用模型(同 base/key)→ MiniMax', () => {
    const a = buildLLMAttempts(false, CFG);
    expect(a.map(x => x.model)).toEqual(['sonnet-4', 'sonnet-4-6', 'opus-4-8', 'MiniMax-M3']);
    // 备用模型与主同 base/key
    expect(a[1].baseURL).toBe('https://gw/v1');
    expect(a[1].apiKey).toBe('k-main');
    // MiniMax 换 base/key
    expect(a[3].baseURL).toBe('https://minimax/v1');
  });

  it('备用模型跳过与主同名的,去重', () => {
    const a = buildLLMAttempts(false, { ...CFG, model: 'sonnet-4-6', altModels: ['sonnet-4-6', 'opus-4-8', 'opus-4-8'] });
    const models = a.map(x => x.model);
    expect(models.filter(m => m === 'sonnet-4-6').length).toBe(1); // 主已是 sonnet-4-6,备用不重复
    expect(models.filter(m => m === 'opus-4-8').length).toBe(1);   // 去重
  });

  it('无 altModels 时链退回 主 → MiniMax(零回归)', () => {
    expect(buildLLMAttempts(false, { ...CFG, altModels: [] }).map(x => x.model)).toEqual(['sonnet-4', 'MiniMax-M3']);
  });

  it('健康缓存:markLLMDown → 冷却内 isLLMDown=true,到期自动恢复', () => {
    const key = llmKey({ baseURL: 'https://gw/v1', model: 'sonnet-4' });
    const t0 = 1_000_000;
    markLLMDown(key, 90_000, t0);
    expect(isLLMDown(key, t0 + 1000)).toBe(true);
    expect(isLLMDown(key, t0 + 90_001)).toBe(false); // 到期恢复
  });

  it('filterHealthyAttempts:跳过冷却中模型;全 down → 保留最后一个(不返回空)', () => {
    const attempts = buildLLMAttempts(false, CFG); // 4 个
    const t0 = 2_000_000;
    markLLMDown(llmKey(attempts[0]), 90_000, t0); // 主饱和
    const healthy = filterHealthyAttempts(attempts, t0 + 100);
    expect(healthy[0].model).toBe('sonnet-4-6'); // 自动切到同网关备用
    expect(healthy.length).toBe(3);
    // 全 down → 保留最后一个
    for (const a of attempts) markLLMDown(llmKey(a), 90_000, t0);
    const last = filterHealthyAttempts(attempts, t0 + 100);
    expect(last.length).toBe(1);
    expect(last[0].model).toBe('MiniMax-M3');
  });
});
