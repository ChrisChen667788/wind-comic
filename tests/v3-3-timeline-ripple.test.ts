/**
 * v3.3 — Timeline ripple edit 单测.
 */

import { describe, it, expect } from 'vitest';
import { computeRipple, computeRippleDelete } from '@/lib/timeline-ripple';
import type { SegmentRange } from '@/lib/timeline-snap';

const segs = (): SegmentRange[] => [
  { id: 'a', startSec: 0, durationSec: 10 },
  { id: 'b', startSec: 10, durationSec: 10 },
  { id: 'c', startSec: 20, durationSec: 10 },
];

describe('v3.3 · computeRipple', () => {
  it('shifts downstream segments by +delta', () => {
    // a 变长 2s (resize-right), 锚点 = a 原 endSec 10, b/c 后移 2s
    const r = computeRipple({ editedId: 'a', allSegments: segs(), deltaSec: 2, anchorSec: 10 });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s]));
    expect(byId.a.startSec).toBe(0);            // edited 不动
    expect(byId.b.startSec).toBe(12);
    expect(byId.c.startSec).toBe(22);
    expect(r.shiftedIds.sort()).toEqual(['b', 'c']);
  });

  it('pulls downstream back on negative delta (缩短)', () => {
    const r = computeRipple({ editedId: 'a', allSegments: segs(), deltaSec: -3, anchorSec: 10 });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s]));
    expect(byId.b.startSec).toBe(7);
    expect(byId.c.startSec).toBe(17);
  });

  it('does not shift upstream segments', () => {
    // 编辑 c, 锚点 20 → 只有 startSec ≥ 20 的会动, a/b 不动
    const r = computeRipple({ editedId: 'c', allSegments: segs(), deltaSec: 5, anchorSec: 20 });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s]));
    expect(byId.a.startSec).toBe(0);
    expect(byId.b.startSec).toBe(10);
    expect(r.shiftedIds).toEqual([]);          // c 是 edited 不算 shift, 没有下游
  });

  it('clamps startSec at 0 (over-pull)', () => {
    const r = computeRipple({ editedId: 'a', allSegments: segs(), deltaSec: -100, anchorSec: 10 });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s]));
    expect(byId.b.startSec).toBe(0);
    expect(byId.c.startSec).toBe(0);
  });

  it('clamps duration when pushed past totalDuration', () => {
    const r = computeRipple({
      editedId: 'a', allSegments: segs(), deltaSec: 5, anchorSec: 10, totalDuration: 28,
    });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s]));
    // c 推到 25, 25+10=35 > 28 → duration clamp 到 3
    expect(byId.c.startSec).toBe(25);
    expect(byId.c.durationSec).toBe(3);
  });

  it('does not mutate input', () => {
    const input = segs();
    computeRipple({ editedId: 'a', allSegments: input, deltaSec: 5, anchorSec: 10 });
    expect(input[1].startSec).toBe(10); // 原数组不变
  });
});

describe('v3.3 · computeRippleDelete', () => {
  it('closes the gap left by a deleted segment', () => {
    // 删 b (10-20), c 往前补 10 → c.start 20 → 10
    const r = computeRippleDelete('b', segs());
    expect(r.segments.find((s) => s.id === 'b')).toBeUndefined();
    const c = r.segments.find((s) => s.id === 'c');
    expect(c?.startSec).toBe(10);
    expect(r.shiftedIds).toContain('c');
  });

  it('deleting unknown id is a no-op copy', () => {
    const r = computeRippleDelete('zzz', segs());
    expect(r.segments).toHaveLength(3);
    expect(r.shiftedIds).toEqual([]);
  });

  it('deleting last segment shifts nothing', () => {
    const r = computeRippleDelete('c', segs());
    expect(r.segments).toHaveLength(2);
    expect(r.shiftedIds).toEqual([]);
  });
});
