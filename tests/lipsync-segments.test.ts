import { describe, it, expect } from 'vitest';
import { buildVisemeSegments, enableExpr, segmentsDuration, VISEME_IDS } from '@/lib/lipsync-segments';

describe('buildVisemeSegments', () => {
  it('空轨 → 单段 sil 覆盖 dur', () => {
    expect(buildVisemeSegments([], 2)).toEqual([{ start: 0, end: 2, viseme: 'sil' }]);
  });
  it('首帧 t>0 → 开头补 sil', () => {
    const segs = buildVisemeSegments([{ t: 0.5, viseme: 'aa' }], 1);
    expect(segs[0]).toEqual({ start: 0, end: 0.5, viseme: 'sil' });
    expect(segs[1]).toEqual({ start: 0.5, end: 1, viseme: 'aa' });
  });
  it('连续覆盖、无缝隙、起于 0', () => {
    const segs = buildVisemeSegments(
      [{ t: 0, viseme: 'aa' }, { t: 0.3, viseme: 'O' }, { t: 0.6, viseme: 'sil' }],
      1,
    );
    expect(segs[0].start).toBe(0);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeCloseTo(segs[i - 1].end, 5);
    expect(segmentsDuration(segs)).toBeCloseTo(1, 5);
  });
  it('合并相邻同 viseme', () => {
    const segs = buildVisemeSegments(
      [{ t: 0, viseme: 'aa' }, { t: 0.2, viseme: 'aa' }, { t: 0.4, viseme: 'O' }],
      0.6,
    );
    expect(segs.filter((s) => s.viseme === 'aa').length).toBe(1);
  });
  it('未知 viseme → 归一为 sil', () => {
    expect(buildVisemeSegments([{ t: 0, viseme: 'ZZZ' }], 0.5)[0].viseme).toBe('sil');
  });
  it('缺 dur → 末帧 t + 尾巴', () => {
    const segs = buildVisemeSegments([{ t: 0, viseme: 'aa' }, { t: 1, viseme: 'sil' }]);
    expect(segmentsDuration(segs)).toBeGreaterThan(1);
  });
});

describe('enableExpr', () => {
  it('同 viseme 多窗口取并集', () => {
    const segs = [
      { start: 0, end: 0.5, viseme: 'aa' as const },
      { start: 1, end: 1.5, viseme: 'aa' as const },
      { start: 0.5, end: 1, viseme: 'O' as const },
    ];
    expect(enableExpr(segs, 'aa')).toBe('between(t,0.000,0.500)+between(t,1.000,1.500)');
    expect(enableExpr(segs, 'O')).toBe('between(t,0.500,1.000)');
  });
  it('无窗口 → 0', () => {
    expect(enableExpr([{ start: 0, end: 1, viseme: 'aa' }], 'U')).toBe('0');
  });
});

describe('VISEME_IDS', () => {
  it('8 个标准 viseme', () => {
    expect(VISEME_IDS).toEqual(['sil', 'MBP', 'FV', 'aa', 'E', 'I', 'O', 'U']);
  });
});
