/**
 * v3.1.3 P2 — timeline-snap unit tests.
 */
import { describe, expect, it } from 'vitest';
import { computeSnap, SNAP_THRESHOLD_SEC } from '@/lib/timeline-snap';

const seg = (id: string, start: number, dur: number) => ({ id, startSec: start, durationSec: dur });

describe('v3.1.3 P2 · computeSnap', () => {
  it('no neighbors → passes through proposed', () => {
    const r = computeSnap({
      selfId: 's1',
      allSegments: [seg('s1', 5, 5)],
      proposedStart: 10,
      proposedDuration: 5,
      totalDuration: 30,
    });
    expect(r.startSec).toBe(10);
    expect(r.durationSec).toBe(5);
    expect(r.snapped).toBe(false);
  });

  it('snaps to left neighbor when within threshold', () => {
    // neighbor ends at 10, propose start 10.2 (delta 0.2 < SNAP_THRESHOLD 0.4) → snap to 10
    const r = computeSnap({
      selfId: 's2',
      allSegments: [seg('s1', 5, 5), seg('s2', 10.2, 5)],
      proposedStart: 10.2,
      proposedDuration: 5,
      totalDuration: 30,
    });
    expect(r.startSec).toBe(10);
    expect(r.snapped).toBe(true);
    expect(r.snappedTo).toBe('s1');
  });

  it('snaps to right neighbor when end is within threshold', () => {
    // self ends at 9.8, right neighbor starts at 10.0 (delta 0.2 < threshold) → snap end to 10.0
    const r = computeSnap({
      selfId: 's1',
      allSegments: [seg('s1', 5, 4.8), seg('s2', 10, 5)],
      proposedStart: 5,
      proposedDuration: 4.8,
      totalDuration: 30,
    });
    expect(r.startSec + r.durationSec).toBeCloseTo(10, 2);
    expect(r.snapped).toBe(true);
    expect(r.snappedTo).toBe('s2');
  });

  it('hard collision → clamps out (no overlap permitted)', () => {
    // proposed = 6..11, neighbor = 5..10 → overlap [6..10]. Self mid=8.5, neighbor mid=7.5
    // self 在 neighbor 右边 → 推 self 起点到 neighbor 终点 (10)
    const r = computeSnap({
      selfId: 's2',
      allSegments: [seg('s1', 5, 5), seg('s2', 6, 5)],
      proposedStart: 6,
      proposedDuration: 5,
      totalDuration: 30,
    });
    expect(r.startSec).toBeGreaterThanOrEqual(10);
    expect(r.snapped).toBe(true);
  });

  it('cannot exceed totalDuration on right', () => {
    const r = computeSnap({
      selfId: 's1',
      allSegments: [seg('s1', 25, 5)],
      proposedStart: 28,
      proposedDuration: 10,
      totalDuration: 30,
    });
    expect(r.startSec + r.durationSec).toBeLessThanOrEqual(30);
  });

  it('startSec floor at 0', () => {
    const r = computeSnap({
      selfId: 's1',
      allSegments: [seg('s1', 0, 5)],
      proposedStart: -5,
      proposedDuration: 5,
      totalDuration: 30,
    });
    expect(r.startSec).toBeGreaterThanOrEqual(0);
  });

  it('duration floor at 0.5s', () => {
    const r = computeSnap({
      selfId: 's1',
      allSegments: [seg('s1', 5, 0.2)],
      proposedStart: 5,
      proposedDuration: 0.2,
      totalDuration: 30,
    });
    expect(r.durationSec).toBeGreaterThanOrEqual(0.5);
  });

  it('exclude self from neighbors (snap own previous position should not register)', () => {
    const r = computeSnap({
      selfId: 's1',
      allSegments: [seg('s1', 10, 5)],
      proposedStart: 10,
      proposedDuration: 5,
      totalDuration: 30,
    });
    expect(r.snapped).toBe(false);
  });

  it('beyond threshold does NOT snap (delta > 0.4s)', () => {
    const r = computeSnap({
      selfId: 's2',
      allSegments: [seg('s1', 5, 5), seg('s2', 11, 5)], // gap = 1s > threshold
      proposedStart: 11,
      proposedDuration: 5,
      totalDuration: 30,
    });
    expect(r.startSec).toBe(11);
    expect(r.snapped).toBe(false);
  });

  it('SNAP_THRESHOLD_SEC constant exposed for UI tuning', () => {
    expect(typeof SNAP_THRESHOLD_SEC).toBe('number');
    expect(SNAP_THRESHOLD_SEC).toBeGreaterThan(0);
  });
});
