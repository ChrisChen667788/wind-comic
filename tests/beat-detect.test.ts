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

describe('v12.0.0 · snapDurationsToBeatsClamped(卡点剪辑:只收紧不越界)', () => {
  it('snap 想拉长超过源片 → clamp 回源片长(不越界)', async () => {
    const { snapDurationsToBeatsClamped } = await import('@/lib/beat-detect');
    // 两镜各 5s,拍点在 4.95 / 10.1:镜1 收紧到 4.95(对齐),镜2 out 想到 10.1(>10)→ clamp
    const { durations, changed } = snapDurationsToBeatsClamped([5, 5], [4.95, 10.1]);
    expect(durations[0]).toBeCloseTo(4.95, 2);       // 收紧对齐
    expect(durations[1]).toBeLessThanOrEqual(5);      // 第二镜不越界源片 5s
    expect(changed).toBeGreaterThanOrEqual(1);
  });

  it('无拍点 → 原样;每镜都 ≤ 源片', async () => {
    const { snapDurationsToBeatsClamped } = await import('@/lib/beat-detect');
    expect(snapDurationsToBeatsClamped([5, 5], []).durations).toEqual([5, 5]);
    const r = snapDurationsToBeatsClamped([3, 4, 5], [2.9, 6.8, 11.9]);
    r.durations.forEach((d, i) => expect(d).toBeLessThanOrEqual([3, 4, 5][i] + 0.001));
  });
});

describe('v12.0.1 · applyEmotionPacing(情绪节奏:只压不拉,对白镜保满长)', () => {
  it('高张力镜快切压缩、情感峰值/对白镜满长、平淡过场轻压', async () => {
    const { applyEmotionPacing } = await import('@/lib/edit-rhythm');
    const { durations, changed } = applyEmotionPacing([
      { durationS: 5, tensionLevel: 10 },                       // 高张力 → 压
      { durationS: 5, emotionTemperature: 9 },                  // 情感峰值 → 满长
      { durationS: 5, tensionLevel: 8, hasDialogue: true },     // 对白镜 → 满长(保配音)
      { durationS: 5, emotionTemperature: 1, tensionLevel: 1 }, // 平淡过场 → 轻压
    ]);
    expect(durations[0]).toBeLessThan(5);          // 高张力压缩
    expect(durations[1]).toBe(5);                  // 峰值满长
    expect(durations[2]).toBe(5);                  // 对白镜满长
    expect(durations[3]).toBeLessThan(5);          // 过场轻压
    durations.forEach((d) => expect(d).toBeLessThanOrEqual(5)); // 只压不拉
    expect(changed).toBe(2);
  });

  it('无情绪数据 → 全满长(诚实降级)', async () => {
    const { applyEmotionPacing } = await import('@/lib/edit-rhythm');
    const r = applyEmotionPacing([{ durationS: 5 }, { durationS: 6 }]);
    expect(r.durations).toEqual([5, 6]);
    expect(r.changed).toBe(0);
  });
});

describe('v12.0.2 · detectKeyShots + 关键镜侧重', () => {
  it('关键镜=开场+集尾+情绪反转+峰值', async () => {
    const { detectKeyShots } = await import('@/lib/edit-rhythm');
    const keys = detectKeyShots([
      { shotNumber: 1, emotionTemperature: 2 },   // 开场
      { shotNumber: 2, emotionTemperature: 1 },
      { shotNumber: 3, emotionTemperature: -8 },  // 反转(Δ9)+ 峰值
      { shotNumber: 4, emotionTemperature: 0 },   // 集尾
    ]);
    expect(keys.has(1)).toBe(true);  // 开场
    expect(keys.has(4)).toBe(true);  // 集尾
    expect(keys.has(3)).toBe(true);  // 反转 + 峰值
    expect(keys.has(2)).toBe(false); // 平凡镜不入
  });

  it('关键镜不被压缩(注意力倾斜):高张力但是关键镜 → 满长', async () => {
    const { applyEmotionPacing } = await import('@/lib/edit-rhythm');
    const keyShots = new Set([1]);
    const { durations } = applyEmotionPacing(
      [{ durationS: 5, tensionLevel: 10, shotNumber: 1 }, { durationS: 5, tensionLevel: 10, shotNumber: 2 }],
      { keyShots },
    );
    expect(durations[0]).toBe(5);          // 关键镜 1:高张力但侧重 → 满长
    expect(durations[1]).toBeLessThan(5);  // 非关键镜 2:高张力 → 快切压缩
  });
});

describe('v12.0.3 · selectTransitions(转场审美)', () => {
  it('关系驱动:张力升→cut、落→dissolve、反转→fade、显式硬切保留', async () => {
    const { selectTransitions } = await import('@/lib/edit-rhythm');
    const t = selectTransitions([
      { shotNumber: 1, tensionLevel: 3 },
      { shotNumber: 2, tensionLevel: 8 },                       // 张力升 → cut
      { shotNumber: 3, tensionLevel: 3 },                       // 张力落 → dissolve
      { shotNumber: 4, tensionLevel: 3, explicit: 'flash-cut' },// 显式硬切保留
      { shotNumber: 5, emotionTemperature: 8 },                 // 前 -? 这里看翻转
    ]);
    expect(t[0]).toBe('');           // 首镜无入场转场
    expect(t[1]).toBe('cut');        // 张力升
    expect(t[2]).toBe('dissolve');   // 张力落
    expect(t[3]).toBe('flash-cut');  // 显式保留
    expect(t.length).toBe(5);
  });

  it('关键镜 → fade', async () => {
    const { selectTransitions } = await import('@/lib/edit-rhythm');
    const t = selectTransitions(
      [{ shotNumber: 1 }, { shotNumber: 2 }],
      new Set([2]),
    );
    expect(t[1]).toBe('fade');
  });

  it('变化性守卫:同转场不连续 3 次', async () => {
    const { selectTransitions } = await import('@/lib/edit-rhythm');
    // 全平淡镜 → 走 variety 轮换,不会出现连 3 个相同
    const clips = Array.from({ length: 8 }, (_, i) => ({ shotNumber: i + 1, tensionLevel: 5, emotionTemperature: 0 }));
    const t = selectTransitions(clips).slice(1);
    for (let i = 2; i < t.length; i++) {
      if (t[i] !== 'cut') expect(t[i] === t[i - 1] && t[i] === t[i - 2]).toBe(false);
    }
  });
});
