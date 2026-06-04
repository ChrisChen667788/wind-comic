/**
 * v9.4.5 — lib/consistency-report 单测(项目级一致性聚合 + 跨轮趋势)。
 */
import { describe, it, expect } from 'vitest';
import { buildConsistencyReport, type ConsistencyScoreLike } from '@/lib/consistency-report';

const mk = (overall: number, continuity: number, lighting: number, face: number): ConsistencyScoreLike =>
  ({ overall, continuity, lighting, face });

describe('v9.4.5 · buildConsistencyReport', () => {
  it('空 → rounds 0 / latest null / 提示先打分', () => {
    const r = buildConsistencyReport([]);
    expect(r.rounds).toBe(0);
    expect(r.latest).toBeNull();
    expect(r.weakest).toBeNull();
    expect(r.series).toEqual([]);
    expect(r.message).toMatch(/尚无|先/);
  });

  it('单轮 → trends 持平 + weakest 取最低维 + 单轮文案', () => {
    const r = buildConsistencyReport([mk(80, 85, 60, 90)]);
    expect(r.rounds).toBe(1);
    expect(r.latest).toEqual(mk(80, 85, 60, 90));
    expect(r.trends.every((t) => t.direction === 'flat')).toBe(true); // first==latest
    expect(r.weakest?.dimension).toBe('lighting'); // 60 最低
    expect(r.message).toMatch(/单轮/);
  });

  it('多轮(newest-first)→ latest=最新 · 趋势方向 · series 转 chronological', () => {
    // index 0 = 最新(round2),index 1 = 最旧(round1)
    const r = buildConsistencyReport([mk(83, 88, 70, 92), mk(79, 80, 72, 85)]);
    expect(r.rounds).toBe(2);
    expect(r.latest?.continuity).toBe(88);
    const byDim = Object.fromEntries(r.trends.map((t) => [t.dimension, t]));
    expect(byDim.continuity.direction).toBe('up');   // 88 vs 80 = +8
    expect(byDim.continuity.delta).toBe(8);
    expect(byDim.lighting.direction).toBe('flat');   // 70 vs 72 = -2 (band ±2)
    expect(byDim.face.direction).toBe('up');         // 92 vs 85 = +7
    // series 旧→新
    expect(r.series[0].continuity).toBe(80);
    expect(r.series[1].continuity).toBe(88);
    expect(r.weakest?.dimension).toBe('lighting');   // 最新 70 最低
    expect(r.message).toMatch(/2 轮/);
  });

  it('下降趋势 → down', () => {
    const r = buildConsistencyReport([mk(60, 60, 55, 65), mk(85, 90, 80, 88)]);
    const cont = r.trends.find((t) => t.dimension === 'continuity')!;
    expect(cont.direction).toBe('down'); // 60 vs 90 = -30
    expect(cont.delta).toBe(-30);
  });

  it('非数字归一为 0', () => {
    const r = buildConsistencyReport([{ overall: NaN, continuity: NaN, lighting: 70, face: 80 } as unknown as ConsistencyScoreLike]);
    expect(r.latest?.continuity).toBe(0);
    expect(r.weakest?.dimension).toBe('continuity'); // 0 最低
  });
});
