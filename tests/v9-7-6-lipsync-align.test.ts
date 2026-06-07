/**
 * v9.7.6 — lib/lipsync-align 单测(口型张口包络 vs 音频能量包络 → 相关性对齐评分)。
 */
import { describe, it, expect } from 'vitest';
import {
  rmsEnvelope, resample, visemeEnvelope, pearson, bestLag, scoreLipAudioAlignment,
  shiftVisemeTrack, autoAlignVisemes,
  type VisemeFrameLike,
} from '@/lib/lipsync-align';

describe('v9.7.6 · 基础数学', () => {
  it('pearson:同向≈1 / 反向≈-1 / 常量→0 / 太短→0', () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 5);
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
    expect(pearson([2, 2, 2], [1, 2, 3])).toBe(0);
    expect(pearson([1], [1])).toBe(0);
  });
  it('resample:线性 / 单点填充 / 空→0', () => {
    expect(resample([0, 1], 3)).toEqual([0, 0.5, 1]);
    expect(resample([5], 3)).toEqual([5, 5, 5]);
    expect(resample([], 2)).toEqual([0, 0]);
  });
  it('rmsEnvelope:逐窗均方根', () => {
    expect(rmsEnvelope([0, 0, 1, 1], 2)).toEqual([0, 1]);
    expect(rmsEnvelope([], 3)).toEqual([0, 0, 0]);
  });
  it('visemeEnvelope:阶梯保持采样', () => {
    const fr: VisemeFrameLike[] = [{ t: 0, mouthOpen: 1 }, { t: 0.5, mouthOpen: 0 }];
    expect(visemeEnvelope(fr, 1, 4)).toEqual([1, 1, 0, 0]);
    expect(visemeEnvelope([], 1, 3)).toEqual([0, 0, 0]);
  });
  it('bestLag:找出最佳时延', () => {
    const a = [0, 0, 1, 1, 0, 0, 1, 1];
    const bDelayed = [0, 0, 0, 1, 1, 0, 0, 1]; // a 右移 1
    const r = bestLag(a, bDelayed, 2);
    expect(r.lag).toBe(1);
    expect(r.corr).toBeCloseTo(1, 5);
  });
});

describe('v9.7.6 · scoreLipAudioAlignment', () => {
  const fr: VisemeFrameLike[] = [
    { t: 0, mouthOpen: 0 }, { t: 0.25, mouthOpen: 1 }, { t: 0.5, mouthOpen: 0 }, { t: 0.75, mouthOpen: 1 },
  ];
  it('张口与能量同步 → 高分 good', () => {
    const r = scoreLipAudioAlignment({ visemes: fr, audioEnergy: [0, 0, 1, 1, 0, 0, 1, 1], durationSec: 1, n: 8 });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.verdict).toBe('good');
    expect(r.lagSec).toBe(0);
  });
  it('张口与能量反相 → 低分 poor', () => {
    const r = scoreLipAudioAlignment({ visemes: fr, audioEnergy: [1, 1, 0, 0, 1, 1, 0, 0], durationSec: 1, n: 8 });
    expect(r.score).toBeLessThan(50);
    expect(r.verdict).toBe('poor');
  });
  it('音频整体滞后 → 检出正时延 lagSec>0', () => {
    // 能量比张口晚 1 帧(dur 1, n 8 → 每帧 0.125s)
    const r = scoreLipAudioAlignment({ visemes: fr, audioEnergy: [0, 0, 0, 1, 1, 0, 0, 1], durationSec: 1, n: 8 });
    expect(r.lagSec).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThanOrEqual(90); // 校正时延后高度对齐
  });
});

describe('v9.7.11 · 漂移自动校正', () => {
  it('shiftVisemeTrack:整体平移 + 保留字段 + 丢负时刻', () => {
    const fr = [{ t: 0, mouthOpen: 1, viseme: 'aa' }, { t: 0.5, mouthOpen: 0, viseme: 'sil' }];
    const fwd = shiftVisemeTrack(fr, 0.1);
    expect(fwd.map((f) => f.t)).toEqual([0.1, 0.6]);
    expect(fwd[0].viseme).toBe('aa'); // 字段保留
    const back = shiftVisemeTrack(fr, -0.2);
    expect(back).toEqual([{ t: 0.3, mouthOpen: 0, viseme: 'sil' }]); // 负时刻帧被丢
  });

  it('autoAlignVisemes:检出漂移 + 校正后裸对齐分不降', () => {
    const fr: VisemeFrameLike[] = [
      { t: 0, mouthOpen: 0 }, { t: 0.25, mouthOpen: 1 }, { t: 0.5, mouthOpen: 0 }, { t: 0.75, mouthOpen: 1 },
    ];
    const r = autoAlignVisemes({ visemes: fr, audioEnergy: [0, 0, 0, 1, 1, 0, 0, 1], durationSec: 1, n: 8 });
    expect(r.offsetSec).toBeGreaterThan(0);          // 音频滞后 → 正补偿
    expect(r.after).toBeGreaterThanOrEqual(r.before); // 校正后裸对齐不更差
    expect(r.visemes[1].t).toBeGreaterThan(fr[1].t);  // 轨整体后移
  });

  it('无漂移 → offset≈0,轨不变', () => {
    const fr: VisemeFrameLike[] = [{ t: 0, mouthOpen: 0 }, { t: 0.25, mouthOpen: 1 }, { t: 0.5, mouthOpen: 0 }, { t: 0.75, mouthOpen: 1 }];
    const r = autoAlignVisemes({ visemes: fr, audioEnergy: [0, 0, 1, 1, 0, 0, 1, 1], durationSec: 1, n: 8 });
    expect(Math.abs(r.offsetSec)).toBeLessThanOrEqual(0.13); // ≤1 帧
  });
});
