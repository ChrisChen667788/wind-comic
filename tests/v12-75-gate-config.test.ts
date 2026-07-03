/**
 * v12.75 — 门禁配置解析(env 可调)。
 */
import { describe, it, expect } from 'vitest';
import { resolveGateConfig } from '@/lib/shot-quality-gate';

describe('v12.75 · resolveGateConfig', () => {
  it('缺省:开 + 70/55 + 1 次重试(与 v12.60 硬编码一致零回归)', () => {
    expect(resolveGateConfig({} as any)).toEqual({ enabled: true, photorealMin: 70, qualityMin: 55, maxRetries: 1 });
  });

  it('env 覆盖 + clamp(阈值 0-100,重试 0-2)', () => {
    const c = resolveGateConfig({ SHOT_GATE_PHOTOREAL_MIN: '85', SHOT_GATE_QUALITY_MIN: '150', SHOT_GATE_MAX_RETRIES: '9' } as any);
    expect(c.photorealMin).toBe(85);
    expect(c.qualityMin).toBe(100);
    expect(c.maxRetries).toBe(2);
  });

  it('SHOT_GATE_DISABLE=1 → enabled=false;非法数字回默认', () => {
    expect(resolveGateConfig({ SHOT_GATE_DISABLE: '1' } as any).enabled).toBe(false);
    expect(resolveGateConfig({ SHOT_GATE_PHOTOREAL_MIN: 'abc' } as any).photorealMin).toBe(70);
  });
});
