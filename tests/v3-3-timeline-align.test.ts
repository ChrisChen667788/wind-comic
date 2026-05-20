/**
 * v3.3 — Timeline 对齐 hint 单测.
 */

import { describe, it, expect } from 'vitest';
import { computeAlignHints, bestAlignHint } from '@/lib/timeline-align';
import type { SegmentRange } from '@/lib/timeline-snap';

const neighbors: SegmentRange[] = [
  { id: 'self', startSec: 50, durationSec: 10 },
  { id: 'n1', startSec: 0, durationSec: 10 },   // start 0, end 10, center 5
  { id: 'n2', startSec: 30, durationSec: 20 },  // start 30, end 50, center 40
];

describe('v3.3 · computeAlignHints', () => {
  it('emits a left-edge alignment to a neighbor edge', () => {
    // self 拖到 start≈30.1 → 左沿对齐 n2.start(30)
    const hints = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 30.1, durationSec: 10,
    });
    const left = hints.find((h) => h.kind === 'left' && h.refId === 'n2');
    expect(left).toBeDefined();
    expect(left?.targetStart).toBeCloseTo(30, 3);
    expect(left?.guideSec).toBeCloseTo(30, 3);
  });

  it('emits a right-edge alignment', () => {
    // self start 40.05, dur 10 → 右沿 50.05 对齐 n2.end(50)
    const hints = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 40.05, durationSec: 10,
    });
    const right = hints.find((h) => h.kind === 'right');
    expect(right).toBeDefined();
    // 右沿对齐 50 → start = 40
    expect(right?.targetStart).toBeCloseTo(40, 3);
  });

  it('emits a center alignment', () => {
    // self center 想对齐 n2.center(40). self dur 10 → center=start+5 → start=35
    const hints = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 35.1, durationSec: 10,
    });
    const center = hints.find((h) => h.kind === 'center');
    expect(center).toBeDefined();
    expect(center?.targetStart).toBeCloseTo(35, 2);
  });

  it('sorts hints by distance ascending', () => {
    const hints = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 30.05, durationSec: 10,
    });
    for (let i = 1; i < hints.length; i++) {
      expect(hints[i].distance).toBeGreaterThanOrEqual(hints[i - 1].distance);
    }
  });

  it('returns empty when nothing within threshold', () => {
    const hints = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 100, durationSec: 10,
    });
    expect(hints).toEqual([]);
  });

  it('honors custom threshold', () => {
    const tight = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 30.3, durationSec: 10, threshold: 0.1,
    });
    expect(tight).toEqual([]); // 0.3 > 0.1
    const loose = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 30.3, durationSec: 10, threshold: 0.5,
    });
    expect(loose.length).toBeGreaterThan(0);
  });

  it('includes extraGuides (act boundary / playhead)', () => {
    const hints = computeAlignHints({
      selfId: 'self', allSegments: neighbors, proposedStart: 64.9, durationSec: 10,
      extraGuides: [65],
    });
    const guideHit = hints.find((h) => h.refId.startsWith('guide:'));
    expect(guideHit).toBeDefined();
    expect(guideHit?.targetStart).toBeCloseTo(65, 2);
  });

  it('never proposes negative targetStart', () => {
    const hints = computeAlignHints({
      selfId: 'self', allSegments: [{ id: 'n', startSec: 0, durationSec: 5 }],
      proposedStart: 0.1, durationSec: 10,
    });
    for (const h of hints) expect(h.targetStart).toBeGreaterThanOrEqual(0);
  });
});

describe('v3.3 · bestAlignHint', () => {
  it('returns the closest hint', () => {
    const best = bestAlignHint({
      selfId: 'self', allSegments: neighbors, proposedStart: 30.05, durationSec: 10,
    });
    expect(best).not.toBeNull();
    expect(best?.distance).toBeLessThanOrEqual(0.4);
  });
  it('returns null when no candidate', () => {
    const best = bestAlignHint({
      selfId: 'self', allSegments: neighbors, proposedStart: 200, durationSec: 10,
    });
    expect(best).toBeNull();
  });
});
