/**
 * v9.1.3 — lib/cover-candidates 单测 (封面提示词 + 主角推断 + 标题安全区).
 */
import { describe, it, expect } from 'vitest';
import {
  buildCoverPrompts, pickProtagonist, getTitleSafeArea, COVER_ASPECT,
} from '@/lib/cover-candidates';

describe('v9.1.3 · buildCoverPrompts', () => {
  it('默认 3 个构图变体 (portrait/dramatic/symbolic), key 唯一', () => {
    const out = buildCoverPrompts({ title: '战神归来' });
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.key)).toEqual(['portrait', 'dramatic', 'symbolic']);
    expect(new Set(out.map((c) => c.prompt)).size).toBe(3); // 3 个提示各不相同
  });

  it('count clamp 1-3', () => {
    expect(buildCoverPrompts({ title: 'x', count: 1 })).toHaveLength(1);
    expect(buildCoverPrompts({ title: 'x', count: 99 })).toHaveLength(3);
    expect(buildCoverPrompts({ title: 'x', count: 0 })).toHaveLength(1);
  });

  it('注入主角 + 画风; 缺省画风 cinematic', () => {
    const withP = buildCoverPrompts({ title: '复仇', protagonist: '阿凯', style: '水墨' });
    expect(withP[0].prompt).toContain('阿凯');
    expect(withP[0].prompt).toContain('水墨');
    const noStyle = buildCoverPrompts({ title: '复仇' });
    expect(noStyle[0].prompt).toContain('cinematic');
  });

  it('片名进 mood; 9:16 + 不画字负向 + 留安全区', () => {
    const out = buildCoverPrompts({ title: '雨夜重逢' });
    expect(out[0].prompt).toContain('雨夜重逢');
    expect(out[0].prompt).toContain('9:16');
    expect(out[0].prompt).toMatch(/do NOT render any text/i);
    expect(out[0].prompt).toMatch(/no text|Negative:/);
    expect(out[0].prompt).toMatch(/negative space in the top and bottom/i);
    expect(COVER_ASPECT).toBe('9:16');
  });
});

describe('v9.1.3 · pickProtagonist', () => {
  it('取出现次数最多的角色', () => {
    const shots = [
      { characters: ['阿凯', '小白'] },
      { characters: ['阿凯'] },
      { characters: ['小白', '阿凯'] },
    ];
    expect(pickProtagonist(shots)).toBe('阿凯'); // 阿凯 3 次 > 小白 2 次
  });

  it('并列时取首个出现的', () => {
    const shots = [{ characters: ['甲'] }, { characters: ['乙'] }];
    expect(pickProtagonist(shots)).toBe('甲');
  });

  it('无角色 / 非数组 / 脏数据 → 空串', () => {
    expect(pickProtagonist([])).toBe('');
    expect(pickProtagonist(undefined)).toBe('');
    expect(pickProtagonist([{ characters: [] }, { characters: [123 as any, '  '] }])).toBe('');
  });
});

describe('v9.1.3 · getTitleSafeArea', () => {
  it('返回中上安全带几何 (百分比, 左右对称)', () => {
    const a = getTitleSafeArea();
    expect(a).toMatchObject({ topPct: 12, leftPct: 8, widthPct: 84, heightPct: 20 });
    expect(a.leftPct * 2 + a.widthPct).toBe(100); // 左右安全边对称
    expect(a.topPct + a.heightPct).toBeLessThan(100);
  });
});
