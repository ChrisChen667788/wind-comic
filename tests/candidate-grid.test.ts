/**
 * 阶段二十九 v12.33.0 — 九宫格候选帧变异引擎单测(纯函数)。
 */
import { describe, expect, it } from 'vitest';
import {
  clampCandidateCount,
  gridDimensions,
  buildCandidatePrompts,
  validatePick,
  CANDIDATE_VARIANTS,
} from '@/lib/candidate-grid';

describe('clampCandidateCount', () => {
  it('合法档原样;其余夹到 4/6/9;缺省 9', () => {
    expect(clampCandidateCount(4)).toBe(4);
    expect(clampCandidateCount(6)).toBe(6);
    expect(clampCandidateCount(9)).toBe(9);
    expect(clampCandidateCount(2)).toBe(4);
    expect(clampCandidateCount(5)).toBe(6);
    expect(clampCandidateCount(8)).toBe(9);
    expect(clampCandidateCount(100)).toBe(9);
    expect(clampCandidateCount(undefined)).toBe(9);
  });
});

describe('gridDimensions', () => {
  it('标准档行列正确', () => {
    expect(gridDimensions(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridDimensions(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridDimensions(4)).toEqual({ cols: 2, rows: 2 });
  });
  it('通用回退 cols=ceil(√n)', () => {
    expect(gridDimensions(3)).toEqual({ cols: 2, rows: 2 });
    expect(gridDimensions(1)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('buildCandidatePrompts', () => {
  it('数量=夹后档,id 连续,每格 prompt 含 base + 取向片段', () => {
    const c = buildCandidatePrompts('a girl on a rooftop', { count: 9 });
    expect(c.length).toBe(9);
    expect(c.map((x) => x.id)).toEqual(Array.from({ length: 9 }, (_, i) => `cand-${i + 1}`));
    expect(c[0].prompt).toContain('a girl on a rooftop');
    expect(c[0].prompt).toContain(CANDIDATE_VARIANTS[0].fragment);
  });
  it('前 N 个取向各异(构图不重复)', () => {
    const c = buildCandidatePrompts('x', { count: 6 });
    const labels = c.map((x) => x.variantLabel);
    expect(new Set(labels).size).toBe(6); // 6 个不同取向
  });
  it('seed 各异 + 确定性(同输入同输出)', () => {
    const a = buildCandidatePrompts('scene one', { count: 9 });
    const b = buildCandidatePrompts('scene one', { count: 9 });
    expect(a.map((x) => x.seed)).toEqual(b.map((x) => x.seed));
    expect(new Set(a.map((x) => x.seed)).size).toBe(9); // 9 个不同 seed
  });
  it('显式 baseSeed 生效', () => {
    const c = buildCandidatePrompts('x', { count: 4, baseSeed: 1000 });
    expect(c[0].seed).toBe(1000);
  });
  it('空 base 也安全(只用取向片段)', () => {
    const c = buildCandidatePrompts('', { count: 4 });
    expect(c[0].prompt).toBe(CANDIDATE_VARIANTS[0].fragment);
  });
});

describe('validatePick', () => {
  it('合法 id 通过;非法 throw', () => {
    const c = buildCandidatePrompts('x', { count: 4 });
    expect(() => validatePick(c, 'cand-2')).not.toThrow();
    expect(() => validatePick(c, 'cand-99')).toThrow(/无效候选/);
  });
});
