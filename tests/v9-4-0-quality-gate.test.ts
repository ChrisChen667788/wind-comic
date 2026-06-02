/**
 * v9.4.0 — lib/quality-gate 单测 (成片质量门禁: 综合 Vision + 成片评分 → 发布就绪裁决).
 */
import { describe, it, expect } from 'vitest';
import { evaluateQualityGate, DEFAULT_QUALITY_THRESHOLDS, type FilmAuditLike, type QualityDimsLike } from '@/lib/quality-gate';

const GOOD_AUDIT: FilmAuditLike = { avgScore: 90, shotCount: 6, failCount: 0, weakestShots: [{ shotNumber: 4, score: 82 }], verdict: 'excellent' };
const GOOD_QS: QualityDimsLike = { overall: 85, continuity: 80, lighting: 82, face: 88 };

describe('v9.4.0 · evaluateQualityGate', () => {
  it('两者皆缺 → warn + 提示先质检, ready', () => {
    const r = evaluateQualityGate({});
    expect(r.level).toBe('warn');
    expect(r.ready).toBe(true);
    expect(r.reasons[0]).toMatch(/尚无质检|先跑/);
  });

  it('pass: vision excellent + 成片全高 → pass, 无 reasons', () => {
    const r = evaluateQualityGate({ filmAudit: GOOD_AUDIT, qualityScore: GOOD_QS });
    expect(r.level).toBe('pass');
    expect(r.ready).toBe(true);
    expect(r.reasons).toHaveLength(0);
    expect(r.weakestShots).toEqual([{ shotNumber: 4, score: 82 }]);
    expect(r.message).toMatch(/达发布标准/);
  });

  it('block: fail 比例超阈值 (2/6 > 10%) → block, 不 ready, 画面对剧本', () => {
    const r = evaluateQualityGate({
      filmAudit: { avgScore: 60, shotCount: 6, failCount: 2, weakestShots: [{ shotNumber: 2, score: 30 }], verdict: 'needs-work' },
    });
    expect(r.level).toBe('block');
    expect(r.ready).toBe(false);
    expect(r.failedDimensions).toContain('画面对剧本');
    expect(r.reasons.join()).toMatch(/严重跑题/);
  });

  it('block: vision verdict poor', () => {
    const r = evaluateQualityGate({ filmAudit: { ...GOOD_AUDIT, failCount: 0, verdict: 'poor' } });
    expect(r.level).toBe('block');
    expect(r.reasons.join()).toMatch(/poor/);
  });

  it('block: 成片综合分低于硬线 50', () => {
    const r = evaluateQualityGate({ qualityScore: { overall: 40, continuity: 60, lighting: 60, face: 60 } });
    expect(r.level).toBe('block');
    expect(r.ready).toBe(false);
    expect(r.reasons.join()).toMatch(/硬线/);
  });

  it('warn: vision needs-work + 平均分偏低, 仍 ready', () => {
    const r = evaluateQualityGate({
      filmAudit: { avgScore: 66, shotCount: 6, failCount: 0, weakestShots: [], verdict: 'needs-work' },
    });
    expect(r.level).toBe('warn');
    expect(r.ready).toBe(true);
    expect(r.reasons.join()).toMatch(/needs-work/);
  });

  it('warn: 成片某维度偏低 → failedDimensions 含该维 + 中等综合分', () => {
    const r = evaluateQualityGate({ filmAudit: GOOD_AUDIT, qualityScore: { overall: 72, continuity: 60, lighting: 82, face: 65 } });
    expect(r.level).toBe('warn');
    expect(r.failedDimensions.some((d) => d.includes('连贯'))).toBe(true);
    expect(r.failedDimensions.some((d) => d.includes('脸一致'))).toBe(true);
    expect(r.failedDimensions.some((d) => d.includes('光影'))).toBe(false); // 82 >= 70
  });

  it('level 取最严: block 原因压过 warn', () => {
    const r = evaluateQualityGate({
      filmAudit: { avgScore: 55, shotCount: 10, failCount: 4, weakestShots: [], verdict: 'poor' },
      qualityScore: { overall: 72, continuity: 60, lighting: 60, face: 60 }, // 这些只产生 warn
    });
    expect(r.level).toBe('block');
    expect(r.ready).toBe(false);
  });

  it('自定义 thresholds: 放宽 maxFailRatio 后同数据变 warn', () => {
    const fa: FilmAuditLike = { avgScore: 72, shotCount: 6, failCount: 1, weakestShots: [], verdict: 'good' };
    expect(evaluateQualityGate({ filmAudit: fa }).level).toBe('block'); // 1/6=0.167 > 0.1 默认
    expect(evaluateQualityGate({ filmAudit: fa, thresholds: { maxFailRatio: 0.2 } }).level).toBe('pass'); // 放宽后不 block, good 无 warn
  });

  it('DEFAULT_QUALITY_THRESHOLDS 暴露且合理', () => {
    expect(DEFAULT_QUALITY_THRESHOLDS.minAvgScore).toBe(70);
    expect(DEFAULT_QUALITY_THRESHOLDS.blockQualityOverall).toBeLessThan(DEFAULT_QUALITY_THRESHOLDS.minQualityOverall);
  });
});
