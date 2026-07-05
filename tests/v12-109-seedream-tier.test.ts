/**
 * v12.109 — seedream 图像档:链尾追加 + 开关。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { appendSeedreamTier, decideImageRoute } from '@/lib/image-router';

afterEach(() => { delete process.env.IMAGE_SEEDREAM_DISABLE; });

describe('v12.109 · appendSeedreamTier', () => {
  it('链尾追加 seedream(不改 primary、不重复)', () => {
    const r = appendSeedreamTier({ primary: 'mj', fallbacks: ['minimax-single', 'kontext'], reason: 'x' } as any);
    expect(r.primary).toBe('mj');
    expect(r.fallbacks[r.fallbacks.length - 1]).toBe('seedream');
    const r2 = appendSeedreamTier(r);
    expect(r2.fallbacks.filter((e) => e === 'seedream').length).toBe(1);
  });

  it('IMAGE_SEEDREAM_DISABLE=1 → 不追加;与 decideImageRoute 组合可用', () => {
    process.env.IMAGE_SEEDREAM_DISABLE = '1';
    const r = appendSeedreamTier({ primary: 'mj', fallbacks: [], reason: 'x' } as any);
    expect(r.fallbacks).toEqual([]);
    delete process.env.IMAGE_SEEDREAM_DISABLE;
    const route = appendSeedreamTier(decideImageRoute({ validRefs: [], mjAvailable: true, minimaxAvailable: false, kontextAvailable: false }));
    expect(route.fallbacks).toContain('seedream');
  });
});
