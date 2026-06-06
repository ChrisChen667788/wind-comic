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
