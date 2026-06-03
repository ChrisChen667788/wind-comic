/**
 * v9.4.2 — lib/rebirth-plan 单测(Vision 重生闭环:质检 → 该重拍哪些镜 + 怎么修)。
 */
import { describe, it, expect } from 'vitest';
import { buildRebirthPlan, type AuditedShotLike } from '@/lib/rebirth-plan';

const mk = (shotNumber: number, score: number, dims?: Partial<AuditedShotLike['dimensions']>, issues?: string[]): AuditedShotLike => ({
  shotNumber, score, dimensions: dims as AuditedShotLike['dimensions'], issues,
});

describe('v9.4.2 · buildRebirthPlan', () => {
  it('空输入 → count 0 + 无需重拍', () => {
    const p = buildRebirthPlan([]);
    expect(p.count).toBe(0);
    expect(p.shots).toEqual([]);
    expect(p.message).toMatch(/无需重拍/);
    expect(p.threshold).toBe(75);
  });

  it('全部 ≥ 阈值 → 不进计划', () => {
    const p = buildRebirthPlan([mk(1, 80), mk(2, 90), mk(3, 75)]);
    expect(p.count).toBe(0);
  });

  it('只收 < 阈值的镜,按分升序(最差先拍)+ 优先级 1..N', () => {
    const p = buildRebirthPlan([mk(1, 88), mk(2, 40), mk(3, 68), mk(4, 55)]);
    expect(p.count).toBe(3);
    expect(p.shots.map((s) => s.shotNumber)).toEqual([2, 4, 3]); // 40 < 55 < 68
    expect(p.shots.map((s) => s.priority)).toEqual([1, 2, 3]);
    expect(p.message).toMatch(/3 个镜头低于 75/);
  });

  it('最弱维度 + focusHint 含维度标签', () => {
    const p = buildRebirthPlan([mk(1, 60, { sceneMatch: 30, actionMatch: 70, moodMatch: 65, composition: 80 })]);
    expect(p.shots[0].weakestDimension).toBe('sceneMatch');
    expect(p.shots[0].focusHint).toMatch(/场景对剧本.*30/);
  });

  it('focusHint 追加首条 issue', () => {
    const p = buildRebirthPlan([mk(1, 55, { composition: 40 }, ['人物出画', '光线过曝'])]);
    expect(p.shots[0].issues).toEqual(['人物出画', '光线过曝']);
    expect(p.shots[0].focusHint).toContain('人物出画');
    expect(p.shots[0].focusHint).toMatch(/构图取景/);
  });

  it('无维度数据 → weakestDimension null + 兜底提示(分 <50 重写, 否则微调)', () => {
    const low = buildRebirthPlan([mk(1, 40)]);
    expect(low.shots[0].weakestDimension).toBeNull();
    expect(low.shots[0].focusHint).toMatch(/整体跑题|重写/);
    const mid = buildRebirthPlan([mk(2, 70)]);
    expect(mid.shots[0].focusHint).toMatch(/细节偏弱|微调/);
  });

  it('自定义 threshold', () => {
    const p = buildRebirthPlan([mk(1, 72), mk(2, 85)], { threshold: 80 });
    expect(p.count).toBe(1);
    expect(p.shots[0].shotNumber).toBe(1);
    expect(p.threshold).toBe(80);
  });

  it('maxShots 按优先级截断', () => {
    const p = buildRebirthPlan([mk(1, 10), mk(2, 20), mk(3, 30), mk(4, 40)], { maxShots: 2 });
    expect(p.count).toBe(2);
    expect(p.shots.map((s) => s.shotNumber)).toEqual([1, 2]); // 两个最差
  });

  it('score 非数字 → 归一为 0(进计划, 最高优先级)', () => {
    const p = buildRebirthPlan([mk(1, NaN as unknown as number), mk(2, 60)]);
    expect(p.shots[0].score).toBe(0);
    expect(p.shots[0].priority).toBe(1);
  });
});
