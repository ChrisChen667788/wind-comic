/**
 * v2.20 P0.3 — Image routing decision matrix.
 *
 * 锁:
 *   - 0 refs → MJ (画质优先)
 *   - 1-2 refs → MJ (cref/sref 原生 fit)
 *   - ≥3 refs → minimax-multi (不浪费 ref)
 *   - 当 minimax 不可用 ≥3 refs → 退到 MJ (会丢 ref 但有图比没有强)
 *   - fallback 链按可用引擎全部排好
 *   - collectValidRefs 去重 + 过滤 data:/ 非 http
 */
import { describe, expect, it } from 'vitest';
import { decideImageRoute, collectValidRefs } from '@/lib/image-router';

describe('v2.20 P0.3 · decideImageRoute', () => {
  it('0 refs + all engines: prefers MJ for quality', () => {
    const d = decideImageRoute({
      validRefs: [],
      mjAvailable: true,
      minimaxAvailable: true,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('mj');
    expect(d.fallbacks).toContain('minimax-single');
    expect(d.fallbacks).toContain('kontext');
  });

  it('1 ref + all engines: MJ (cref/sref fit)', () => {
    const d = decideImageRoute({
      validRefs: ['https://a.png'],
      mjAvailable: true,
      minimaxAvailable: true,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('mj');
  });

  it('2 refs + all engines: MJ (cref+sref native)', () => {
    const d = decideImageRoute({
      validRefs: ['https://a.png', 'https://b.png'],
      mjAvailable: true,
      minimaxAvailable: true,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('mj');
    expect(d.reason).toContain('native fit');
  });

  it('3 refs + all engines: prefers minimax-multi (key improvement)', () => {
    const d = decideImageRoute({
      validRefs: ['https://a.png', 'https://b.png', 'https://c.png'],
      mjAvailable: true,
      minimaxAvailable: true,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('minimax-multi');
    // MJ 仍在 fallback 里 (会丢 1 ref 但仍能跑)
    expect(d.fallbacks).toContain('mj');
    expect(d.reason).toMatch(/would drop \d+/);
  });

  it('4+ refs: minimax-multi primary, MJ fallback (degrade graceful)', () => {
    const d = decideImageRoute({
      validRefs: ['a', 'b', 'c', 'd', 'e'].map((x) => `https://${x}.png`),
      mjAvailable: true,
      minimaxAvailable: true,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('minimax-multi');
    expect(d.fallbacks[0]).toBe('mj');
  });

  it('3 refs + minimax unavailable: MJ (best available, will drop refs)', () => {
    const d = decideImageRoute({
      validRefs: ['https://a.png', 'https://b.png', 'https://c.png'],
      mjAvailable: true,
      minimaxAvailable: false,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('mj');
    expect(d.reason).toContain('first 2');
  });

  it('3 refs + MJ unavailable: minimax-multi → kontext', () => {
    const d = decideImageRoute({
      validRefs: ['https://a.png', 'https://b.png', 'https://c.png'],
      mjAvailable: false,
      minimaxAvailable: true,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('minimax-multi');
    expect(d.fallbacks).toEqual(['kontext']);
  });

  it('0 refs + only kontext: last resort', () => {
    const d = decideImageRoute({
      validRefs: [],
      mjAvailable: false,
      minimaxAvailable: false,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('kontext');
  });

  it('1 ref + only kontext: degraded but works', () => {
    const d = decideImageRoute({
      validRefs: ['https://a.png'],
      mjAvailable: false,
      minimaxAvailable: false,
      kontextAvailable: true,
    });
    expect(d.primary).toBe('kontext');
  });

  it('no engines at all: last-resort kontext (will throw downstream)', () => {
    const d = decideImageRoute({
      validRefs: [],
      mjAvailable: false,
      minimaxAvailable: false,
      kontextAvailable: false,
    });
    expect(d.primary).toBe('kontext');
    expect(d.fallbacks).toEqual([]);
  });
});

describe('v2.20 P0.3 · collectValidRefs', () => {
  it('combines cref + sref + referenceImages in order', () => {
    const out = collectValidRefs({
      cref: 'https://c.png',
      sref: 'https://s.png',
      referenceImages: ['https://r1.png', 'https://r2.png'],
    });
    expect(out).toEqual(['https://c.png', 'https://s.png', 'https://r1.png', 'https://r2.png']);
  });

  it('dedupes URLs across slots', () => {
    const out = collectValidRefs({
      cref: 'https://a.png',
      sref: 'https://b.png',
      referenceImages: ['https://a.png', 'https://c.png'],
    });
    expect(out).toEqual(['https://a.png', 'https://b.png', 'https://c.png']);
  });

  it('filters out data: URIs', () => {
    const out = collectValidRefs({
      cref: 'data:image/png;base64,xxx',
      sref: 'https://b.png',
      referenceImages: ['data:image/svg+xml,yyy', 'https://c.png'],
    });
    expect(out).toEqual(['https://b.png', 'https://c.png']);
  });

  it('handles undefined/empty inputs', () => {
    expect(collectValidRefs({})).toEqual([]);
    expect(collectValidRefs({ referenceImages: [] })).toEqual([]);
    expect(collectValidRefs({ cref: '', sref: undefined })).toEqual([]);
  });

  it('filters non-string entries in referenceImages', () => {
    const out = collectValidRefs({
      // @ts-expect-error - testing runtime guard
      referenceImages: ['https://a.png', null, undefined, 42, 'https://b.png'],
    });
    expect(out).toEqual(['https://a.png', 'https://b.png']);
  });
});
