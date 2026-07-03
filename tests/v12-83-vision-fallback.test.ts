/**
 * v12.83 — 跨网关视觉兜底解析。
 */
import { describe, it, expect } from 'vitest';
import { resolveVisionFallback } from '@/lib/shot-quality-gate';

describe('v12.83 · resolveVisionFallback', () => {
  it('显式 env 优先(base+key,model 可缺省)', () => {
    const r = resolveVisionFallback({ VISION_FALLBACK_BASE_URL: 'https://x/v1', VISION_FALLBACK_API_KEY: 'k', MINIMAX_API_KEY: 'mk' } as any);
    expect(r).toEqual({ baseURL: 'https://x/v1', apiKey: 'k', model: 'abab7-chat-preview' });
  });

  it('无显式 env 但有 MINIMAX_API_KEY → MiniMax 直连 abab7', () => {
    const r = resolveVisionFallback({ MINIMAX_API_KEY: 'mk' } as any);
    expect(r!.baseURL).toBe('https://api.minimaxi.com/v1');
    expect(r!.model).toBe('abab7-chat-preview');
  });

  it('VISION_FALLBACK_MODEL 覆盖;全无 → null', () => {
    expect(resolveVisionFallback({ MINIMAX_API_KEY: 'mk', VISION_FALLBACK_MODEL: 'my-vlm' } as any)!.model).toBe('my-vlm');
    expect(resolveVisionFallback({} as any)).toBeNull();
  });
});
