/**
 * Sprint B.3 — Beat-driven editing 单测
 *
 * 锁住对齐算法的关键决策路径(纯函数, 不打 ffmpeg):
 *   · 没 beat → 原样返回
 *   · enabled=false → 原样返回
 *   · ±SNAP_WINDOW_S 内有 beat → out 对齐
 *   · 超出窗口 → 不动
 *   · MIN_DURATION 保护:snap 不允许把镜头压成 < 0.5s 或 < 60% 原时长
 *   · findNearestBeat 二分边界
 */

import { describe, it, expect } from 'vitest';
import {
  snapDurationsToBeats,
  findNearestBeat,
  BEAT_SNAP_WINDOW_S,
} from '@/lib/beat-detect';

describe('findNearestBeat (Sprint B.3)', () => {
  it('returns null for empty beats', () => {
    expect(findNearestBeat(5.0, [])).toBeNull();
  });

  it('finds the closest beat by absolute distance', () => {
    const beats = [1.0, 2.0, 3.0, 5.0, 8.0];
    expect(findNearestBeat(2.4, beats)).toBe(2.0);
    expect(findNearestBeat(2.6, beats)).toBe(3.0);
    expect(findNearestBeat(0.5, beats)).toBe(1.0);
    expect(findNearestBeat(10, beats)).toBe(8.0);
  });

  it('handles ties by returning either side (deterministic per implementation)', () => {
    const beats = [1.0, 3.0];
    expect(findNearestBeat(2.0, beats)).toBe(3.0); // current impl prefers >= side
  });
});

describe('snapDurationsToBeats (Sprint B.3)', () => {
  it('returns durations unchanged when there are no beats', () => {
    const durs = [3, 5, 4];
    expect(snapDurationsToBeats(durs, [])).toEqual(durs);
  });

  it('returns durations unchanged when enabled=false', () => {
    const durs = [3, 5, 4];
    const beats = [3.05, 8.1, 12.05];
    expect(snapDurationsToBeats(durs, beats, { enabled: false })).toEqual(durs);
  });

  it('snaps shot out-times to nearest beat within ±SNAP_WINDOW_S', () => {
    const durs = [3.0, 5.0, 4.0]; // outs = 3, 8, 12
    // beats are within window for all three
    const beats = [3.05, 8.1, 12.05];
    const adjusted = snapDurationsToBeats(durs, beats);
    expect(adjusted[0]).toBeCloseTo(3.05, 2);
    expect(adjusted[1]).toBeCloseTo(8.1 - 3.05, 2);
    expect(adjusted[2]).toBeCloseTo(12.05 - 8.1, 2);
  });

  it('keeps out unchanged when nearest beat is outside snap window', () => {
    const durs = [3.0, 5.0]; // outs = 3, 8
    // beat at 3.5 is beyond default 0.15s window from 3.0
    const beats = [3.5, 8.05];
    const adjusted = snapDurationsToBeats(durs, beats);
    expect(adjusted[0]).toBe(3.0); // unchanged
    expect(adjusted[1]).toBeCloseTo(8.05 - 3.0, 2); // second snapped
  });

  it('honors custom snap window', () => {
    const durs = [3.0];
    const beats = [3.4];
    // default window 0.15 → 3.4 too far, no snap
    expect(snapDurationsToBeats(durs, beats)[0]).toBe(3.0);
    // expanded window 0.5 → snap
    expect(snapDurationsToBeats(durs, beats, { snapWindowS: 0.5 })[0]).toBeCloseTo(3.4, 2);
  });

  it('does not allow a shot to be compressed below 60% of original or 0.5s', () => {
    const durs = [2.0, 3.0]; // outs = 2, 5
    // Pretend a beat at 0.1 would snap first out way down — but we clamp.
    // To trigger the clamp, we use a wide custom window so the beat is "in range".
    const beats = [0.1, 5.05];
    const adjusted = snapDurationsToBeats(durs, beats, { snapWindowS: 5 });
    // First clamped to max(0.5, 2.0*0.6=1.2) = 1.2
    expect(adjusted[0]).toBeGreaterThanOrEqual(1.2);
  });

  it('uses BEAT_SNAP_WINDOW_S = 0.15 by default', () => {
    expect(BEAT_SNAP_WINDOW_S).toBe(0.15);
  });

  it('returns the same array length as input', () => {
    const durs = [1, 2, 3, 4, 5];
    const beats = [1.05, 3.0, 6.05, 10.05, 15.05];
    const adjusted = snapDurationsToBeats(durs, beats);
    expect(adjusted).toHaveLength(durs.length);
  });
});
