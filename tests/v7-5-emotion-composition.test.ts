/**
 * v7.5 — lib/emotion-curve + lib/composition 单测 (情感曲线 / 节奏热力图 / 构图引导)
 */

import { describe, it, expect } from 'vitest';
import {
  emotionScore, brightnessFor, rhythmFor, computeEmotionCurve, curveStats, describeCurve,
  type EmotionShotInput,
} from '@/lib/emotion-curve';
import {
  COMPOSITION_GUIDES, compileCompositionPrompt, computeCompositionHints, cameraPathPoints,
} from '@/lib/composition';

describe('emotionScore', () => {
  it('精确命中词典', () => {
    expect(emotionScore('愤怒').tension).toBeGreaterThan(80);
    expect(emotionScore('平静').intensity).toBeLessThan(30);
  });
  it('子串模糊命中 (取最强)', () => {
    expect(emotionScore('压抑的紧张感').tension).toBeGreaterThan(70); // 含"紧张"
  });
  it('未命中 → 中性', () => {
    const n = emotionScore('随便什么');
    expect(n.intensity).toBe(40);
    expect(emotionScore('').intensity).toBe(40);
  });
});

describe('brightnessFor / rhythmFor', () => {
  it('直接给亮度优先', () => {
    expect(brightnessFor({ brightness: 90 })).toBe(90);
  });
  it('low-key 暗 / high-key 亮; 夜晚氛围压暗', () => {
    expect(brightnessFor({ lightingSetup: 'low-key' })).toBeLessThan(40);
    expect(brightnessFor({ lightingSetup: 'high-key' })).toBeGreaterThan(80);
    expect(brightnessFor({ lightingSetup: 'natural', atmosphere: 'night' })).toBeLessThan(brightnessFor({ lightingSetup: 'natural' }));
  });
  it('时长越短节奏越快; 运动加成', () => {
    expect(rhythmFor({ durationS: 2 })).toBeGreaterThan(rhythmFor({ durationS: 10 }));
    expect(rhythmFor({ durationS: 5, motion: 90 })).toBeGreaterThan(rhythmFor({ durationS: 5, motion: 10 }));
  });
});

describe('computeEmotionCurve + stats', () => {
  const shots: EmotionShotInput[] = [
    { emotion: '平静', durationS: 6, motion: 20, lightingSetup: 'natural' },
    { emotion: '紧张', durationS: 4, motion: 50, conflict: 7, lightingSetup: 'low-key' },
    { emotion: '震惊', durationS: 2, motion: 80, conflict: 9, lightingSetup: 'neon-noir', atmosphere: 'night' },
  ];
  it('每镜出 4 轨点; 冲突抬高紧张', () => {
    const curve = computeEmotionCurve(shots);
    expect(curve).toHaveLength(3);
    expect(curve[0]).toHaveProperty('emotion');
    expect(curve[0]).toHaveProperty('tension');
    expect(curve[0]).toHaveProperty('rhythm');
    expect(curve[0]).toHaveProperty('brightness');
    // 第 3 镜震惊+高冲突 → 情感/紧张高于第 1 镜平静
    expect(curve[2].emotion).toBeGreaterThan(curve[0].emotion);
    expect(curve[2].tension).toBeGreaterThan(curve[0].tension);
    // 第 3 镜短+高运动 → 节奏更快; neon-noir+夜 → 更暗
    expect(curve[2].rhythm).toBeGreaterThan(curve[0].rhythm);
    expect(curve[2].brightness).toBeLessThan(curve[0].brightness);
  });
  it('空输入 → 空曲线 + 空 stats', () => {
    expect(computeEmotionCurve([])).toEqual([]);
    expect(computeEmotionCurve(null as any)).toEqual([]);
    const st = curveStats([]);
    expect(st.count).toBe(0);
    expect(st.climaxIndex).toBe(-1);
  });
  it('stats: climaxIndex = 情感最高镜', () => {
    const st = curveStats(computeEmotionCurve(shots));
    expect(st.count).toBe(3);
    expect(st.climaxIndex).toBe(2); // 震惊最高
    expect(st.peakEmotion).toBeGreaterThan(0);
  });
  it('describeCurve 含高潮镜号', () => {
    expect(describeCurve(computeEmotionCurve(shots))).toContain('第 3 镜');
    expect(describeCurve([])).toContain('暂无');
  });
});

describe('composition', () => {
  it('COMPOSITION_GUIDES + compileCompositionPrompt', () => {
    expect(COMPOSITION_GUIDES.length).toBeGreaterThanOrEqual(4);
    expect(compileCompositionPrompt('thirds')).toContain('rule of thirds');
    expect(compileCompositionPrompt('nope' as any)).toBe('');
  });
  it('computeCompositionHints: CU 紧头部空间, WS 充足 + 负空间', () => {
    const cu = computeCompositionHints({ shotSize: 'CU', angle: 'eye' });
    expect(cu.facePosition).toContain('上三分');
    expect(cu.headroom).toContain('紧');
    const ws = computeCompositionHints({ shotSize: 'WS', angle: 'eye' });
    expect(ws.headroom).toContain('充足');
    expect(ws.balance).toContain('负空间');
  });
  it('荷兰角 → 视线空间倾斜', () => {
    expect(computeCompositionHints({ shotSize: 'MS', angle: 'dutch' }).lookRoom).toContain('倾斜');
  });
  it('cameraPathPoints: 各运镜给合法 path + 焦点', () => {
    const push = cameraPathPoints('push-in');
    expect(push.path).toMatch(/^M/);
    expect(push.label).toBe('推近');
    expect(typeof push.focusX).toBe('number');
    expect(cameraPathPoints('pan').label).toBe('横摇');
    expect(cameraPathPoints('static').label).toBe('固定');
    expect(cameraPathPoints('orbit').path).toContain('A'); // 弧线
  });
});
