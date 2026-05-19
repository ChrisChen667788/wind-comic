/**
 * v3.2 P3.2 — Cross-act snap unit tests.
 *
 * 验证 actBoundaries 选项不破坏 v3.1.3 邻居 snap 语义, 同时新增的 act 边界
 * snap 在邻居 snap 不命中时生效, 优先级正确.
 */

import { describe, it, expect } from 'vitest';
import { computeSnap, SNAP_THRESHOLD_SEC } from '@/lib/timeline-snap';

describe('v3.2 P3.2 · cross-act snap (actBoundaries)', () => {
  it('snaps proposed start to nearby act boundary', () => {
    // 段 A 在 act1, 拖到 startSec=29.85 (act1→act2 边界 30s 在阈值 0.4 内)
    const r = computeSnap({
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 5, durationSec: 5 }],
      proposedStart: 29.85,
      proposedDuration: 5,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.snapped).toBe(true);
    expect(r.snappedTo).toMatch(/^act:\d+$/);
    expect(r.startSec).toBeCloseTo(30, 3);
    expect(r.durationSec).toBeCloseTo(5, 3);
  });

  it('snaps proposed END to nearby act boundary (整段平移)', () => {
    // 段长 5s, proposed start=24.7 → end=29.7, act 边界 30 在阈值内
    const r = computeSnap({
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 0, durationSec: 5 }],
      proposedStart: 24.7,
      proposedDuration: 5,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.snapped).toBe(true);
    expect(r.snappedTo).toMatch(/^act:\d+$/);
    // 整段往右挪让 end == 30
    expect(r.startSec + r.durationSec).toBeCloseTo(30, 3);
  });

  it('does NOT snap when act boundary is beyond threshold', () => {
    // start=25, duration=3 → end=28. 离 act 边界 30 是 2s, 远超 SNAP_THRESHOLD_SEC (0.4).
    // 也确保 start 25 离 0 / 30 / 65 都 ≥ 2s, 没有 act 边界在阈值内
    const r = computeSnap({
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 0, durationSec: 3 }],
      proposedStart: 25,
      proposedDuration: 3,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.snapped).toBe(false);
    expect(r.snappedTo).toBeNull();
    expect(r.startSec).toBeCloseTo(25, 3);
  });

  it('neighbor snap takes priority over act snap', () => {
    // 邻居 endSec=29.9 (距离 proposed 30 是 0.1), act 边界 30 也在阈值
    // 邻居 snap 应该先命中, 不留给 act snap
    const r = computeSnap({
      selfId: 'A',
      allSegments: [
        { id: 'A', startSec: 50, durationSec: 5 },
        { id: 'left-neighbor', startSec: 20, durationSec: 9.9 },
      ],
      proposedStart: 30,
      proposedDuration: 5,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.snapped).toBe(true);
    expect(r.snappedTo).toBe('left-neighbor');
    expect(r.startSec).toBeCloseTo(29.9, 3);
  });

  it('omitting actBoundaries (or empty []) leaves v3.1.3 behavior unchanged', () => {
    const inputNoBounds = {
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 5, durationSec: 5 }],
      proposedStart: 29.85,
      proposedDuration: 5,
      totalDuration: 120,
    };
    const rNo = computeSnap(inputNoBounds);
    const rEmpty = computeSnap({ ...inputNoBounds, actBoundaries: [] });
    expect(rNo.snapped).toBe(false);
    expect(rEmpty.snapped).toBe(false);
    // 无 actBoundaries → 无 snap, start 保持 proposed (但 clamp 仍然生效)
    expect(rNo.startSec).toBeCloseTo(29.85, 3);
    expect(rEmpty.startSec).toBeCloseTo(29.85, 3);
  });

  it('picks the closest of two candidate act boundaries', () => {
    // 段 start 在 65.05, 离 65 距离 0.05, 离 100 距离 ~35 → 应该贴 65
    const r = computeSnap({
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 65.05, durationSec: 5 }],
      proposedStart: 65.05,
      proposedDuration: 5,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.snapped).toBe(true);
    expect(r.startSec).toBeCloseTo(65, 3);
  });

  it('does not over-snap when boundary equals proposed start (delta 0)', () => {
    // proposed=30 正好等于 act 边界 30 — 不需要 shift, snapped 仍标 true
    // (delta=0 也算 snap, 给 UI 高亮提示)
    const r = computeSnap({
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 30, durationSec: 5 }],
      proposedStart: 30,
      proposedDuration: 5,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.startSec).toBeCloseTo(30, 3);
    expect(r.snapped).toBe(true);
  });

  it('respects SNAP_THRESHOLD_SEC constant exactly', () => {
    // 测试边界值 — 距离 = THRESHOLD 也应该 snap
    const r = computeSnap({
      selfId: 'A',
      allSegments: [{ id: 'A', startSec: 0, durationSec: 5 }],
      proposedStart: 30 - SNAP_THRESHOLD_SEC + 0.001,  // 比 threshold 略小
      proposedDuration: 5,
      totalDuration: 120,
      actBoundaries: [0, 30, 65, 100, 120],
    });
    expect(r.snapped).toBe(true);
    expect(r.startSec).toBeCloseTo(30, 3);
  });
});
