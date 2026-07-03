/**
 * v12.64 — 商业 plan 确定性净化(锚点硬保险)。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeCommercialPlan } from '@/lib/end-card';

describe('v12.64 · sanitizeCommercialPlan', () => {
  it('古装 genre → 现代商业(实测 case:古装职业)', () => {
    const p: any = { genre: '古装职业' };
    const r = sanitizeCommercialPlan(p);
    expect(r.changed).toBe(true);
    expect(p.genre).toBe('现代商业');
  });

  it('styleKeywords 剔 octane/ancient token 并补 photoreal(实测 case)', () => {
    const p: any = { genre: '现代商业', styleKeywords: 'cold blue palette, octane render quality, sleek modern ancient fusion costume, volumetric lighting' };
    const r = sanitizeCommercialPlan(p);
    expect(r.changed).toBe(true);
    expect(p.styleKeywords).not.toMatch(/octane|ancient/i);
    expect(p.styleKeywords).toContain('cold blue palette');
    expect(p.styleKeywords).toContain('volumetric lighting');
    expect(p.styleKeywords).toContain('photorealistic');
  });

  it('style 全违禁被清空 → 兜底「现代写实商业风」', () => {
    const p: any = { style: '现代古装融合风' };
    sanitizeCommercialPlan(p);
    expect(p.style).toBe('现代写实商业风');
  });

  it('干净 plan 不动(changed=false,字段原样)', () => {
    const p: any = { genre: '现代商业', style: '高级冷色调现实主义', styleKeywords: 'photorealistic, ARRI, film grain' };
    const before = JSON.stringify(p);
    expect(sanitizeCommercialPlan(p).changed).toBe(false);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('undefined 字段容错', () => {
    expect(sanitizeCommercialPlan({}).changed).toBe(false);
  });
});
