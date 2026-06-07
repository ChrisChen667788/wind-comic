/**
 * v9.7.5 — lib/lipsync-qc 单测(口型质检回环决策:done/rerender/stop + 限定本批镜)。
 */
import { describe, it, expect } from 'vitest';
import { planLipSyncQc } from '@/lib/lipsync-qc';

describe('v9.7.5 · planLipSyncQc', () => {
  it('全部达标 → done', () => {
    const v = planLipSyncQc({ audits: [{ shotNumber: 1, score: 85 }, { shotNumber: 2, score: 90 }], round: 1 });
    expect(v.decision).toBe('done');
    expect(v.weakShots).toEqual([]);
    expect(v.message).toMatch(/通过/);
  });

  it('有弱镜 + 未到轮上限 → rerender(分数升序)', () => {
    const v = planLipSyncQc({
      audits: [{ shotNumber: 1, score: 50 }, { shotNumber: 2, score: 88 }, { shotNumber: 3, score: 60 }],
      round: 1, maxRounds: 2,
    });
    expect(v.decision).toBe('rerender');
    expect(v.weakShots).toEqual([1, 3]); // 50 < 60 升序
  });

  it('有弱镜 + 已到轮上限 → stop(转人工)', () => {
    const v = planLipSyncQc({ audits: [{ shotNumber: 1, score: 50 }], round: 2, maxRounds: 2 });
    expect(v.decision).toBe('stop');
    expect(v.weakShots).toEqual([1]);
    expect(v.message).toMatch(/转人工/);
  });

  it('onlyShots 限定只评本批镜', () => {
    const v = planLipSyncQc({
      audits: [{ shotNumber: 1, score: 50 }, { shotNumber: 9, score: 40 }],
      round: 1, onlyShots: [1],
    });
    expect(v.weakShots).toEqual([1]); // 镜9 虽更弱但不在本批,被滤
  });

  it('自定义阈值', () => {
    const v = planLipSyncQc({ audits: [{ shotNumber: 1, score: 80 }], round: 1, threshold: 90 });
    expect(v.decision).toBe('rerender');
    expect(v.weakShots).toEqual([1]);
  });
});

describe('v9.7.8 · 对齐分并入弱镜判定', () => {
  it('画面达标但音画对齐低 → 仍判弱镜(触发重渲)', () => {
    const v = planLipSyncQc({
      audits: [{ shotNumber: 1, score: 90 }, { shotNumber: 2, score: 88 }],
      alignScores: { 2: 40 }, round: 1,
    });
    expect(v.decision).toBe('rerender');
    expect(v.weakShots).toEqual([2]);
    expect(v.message).toMatch(/音画对不上/);
  });

  it('Vision 弱 + 对齐弱 → 并集去重(Vision 在前,对齐分升序在后)', () => {
    const v = planLipSyncQc({
      audits: [{ shotNumber: 1, score: 50 }, { shotNumber: 2, score: 95 }, { shotNumber: 3, score: 92 }],
      alignScores: { 1: 30, 2: 55, 3: 40 }, round: 1,
    });
    // 镜1 已是 Vision 弱(不因 align 重复);镜3(40)< 镜2(55)→ 对齐弱升序 [3,2]
    expect(v.weakShots).toEqual([1, 3, 2]);
  });

  it('对齐分 ≥ 阈值 → 不计;onlyShots 限定', () => {
    const v = planLipSyncQc({
      audits: [{ shotNumber: 1, score: 90 }],
      alignScores: { 1: 70, 9: 10 }, alignThreshold: 60, onlyShots: [1], round: 1,
    });
    expect(v.decision).toBe('done'); // 镜1 对齐 70≥60 不弱;镜9 不在 onlyShots
  });
});
