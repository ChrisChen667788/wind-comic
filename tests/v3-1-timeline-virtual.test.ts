/**
 * v3.1 F.2 — Virtual scroll helper.
 */
import { describe, expect, it } from 'vitest';
import { visibleRange, shouldVirtualize } from '@/lib/timeline-virtual';

describe('v3.1 F.2 · shouldVirtualize', () => {
  it('returns false for short lists', () => {
    expect(shouldVirtualize(6)).toBe(false);
    expect(shouldVirtualize(12)).toBe(false);
  });

  it('returns true above default threshold', () => {
    expect(shouldVirtualize(13)).toBe(true);
    expect(shouldVirtualize(100)).toBe(true);
  });

  it('honors custom threshold', () => {
    expect(shouldVirtualize(20, 30)).toBe(false);
    expect(shouldVirtualize(31, 30)).toBe(true);
  });
});

describe('v3.1 F.2 · visibleRange', () => {
  it('shows full range when total count fits viewport', () => {
    const r = visibleRange({
      totalCount: 5, itemWidth: 100, scrollLeft: 0, viewportWidth: 800, gap: 0,
    });
    expect(r.startIdx).toBe(0);
    expect(r.endIdx).toBe(5);
    expect(r.leftPad).toBe(0);
  });

  it('computes correct window for scrolled position', () => {
    // 100 items × 100px wide, viewport 500px, scrollLeft 1000 (= item 10 left edge)
    const r = visibleRange({
      totalCount: 100, itemWidth: 100, scrollLeft: 1000, viewportWidth: 500, gap: 0, buffer: 0,
    });
    expect(r.startIdx).toBe(10);
    expect(r.endIdx).toBe(15);
    expect(r.leftPad).toBe(1000);
    expect(r.rightPad).toBe((100 - 15) * 100);
  });

  it('clamps at boundaries (no negative startIdx)', () => {
    const r = visibleRange({
      totalCount: 50, itemWidth: 100, scrollLeft: 0, viewportWidth: 500, gap: 0, buffer: 5,
    });
    expect(r.startIdx).toBe(0); // buffer doesn't go negative
    expect(r.endIdx).toBeGreaterThan(5);
  });

  it('handles gap correctly in stride calculation', () => {
    // items 100px + 8px gap = stride 108
    const r = visibleRange({
      totalCount: 20, itemWidth: 100, scrollLeft: 540, viewportWidth: 432, gap: 8, buffer: 0,
    });
    // scrollLeft 540 / 108 = 5, so first visible = 5
    expect(r.startIdx).toBe(5);
    // viewport ends at 540+432=972, /108 ≈ 9, ceil = 9
    expect(r.endIdx).toBe(9);
  });

  it('returns empty for invalid inputs', () => {
    expect(visibleRange({ totalCount: 0, itemWidth: 100, scrollLeft: 0, viewportWidth: 500 })).toEqual({
      startIdx: 0, endIdx: 0, leftPad: 0, rightPad: 0,
    });
    expect(visibleRange({ totalCount: 10, itemWidth: 0, scrollLeft: 0, viewportWidth: 500 })).toEqual({
      startIdx: 0, endIdx: 0, leftPad: 0, rightPad: 0,
    });
  });

  it('applies buffer beyond viewport', () => {
    const r = visibleRange({
      totalCount: 100, itemWidth: 100, scrollLeft: 1000, viewportWidth: 500, gap: 0, buffer: 3,
    });
    expect(r.startIdx).toBe(7);  // 10 - 3
    expect(r.endIdx).toBe(18);   // 15 + 3
  });

  it('clamps endIdx to totalCount', () => {
    const r = visibleRange({
      totalCount: 10, itemWidth: 100, scrollLeft: 800, viewportWidth: 500, gap: 0, buffer: 5,
    });
    expect(r.endIdx).toBe(10);
    expect(r.rightPad).toBe(0);
  });
});
