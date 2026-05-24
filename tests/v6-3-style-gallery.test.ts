/**
 * v6.3 — 风格画廊 helpers 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  STYLE_PRESETS, STYLE_CATEGORIES, categoryLabel, searchStyles,
  getStylesByCategory, getPopularStyles,
} from '@/lib/style-presets';

describe('v6.3 · STYLE_CATEGORIES / categoryLabel', () => {
  it('5 个分类有序 + 中文标签', () => {
    expect(STYLE_CATEGORIES.map((c) => c.id)).toEqual(['realistic', 'anime', 'artistic', 'retro', 'experimental']);
    expect(categoryLabel('realistic')).toBe('写实');
    expect(categoryLabel('anime')).toBe('动漫');
  });
  it('未知分类兜底原值', () => {
    expect(categoryLabel('weird')).toBe('weird');
  });
  it('每个分类都有预设', () => {
    for (const c of STYLE_CATEGORIES) {
      expect(getStylesByCategory(c.id).length).toBeGreaterThan(0);
    }
  });
});

describe('v6.3 · searchStyles', () => {
  it('空 query 返全部', () => {
    expect(searchStyles('')).toHaveLength(STYLE_PRESETS.length);
    expect(searchStyles('   ')).toHaveLength(STYLE_PRESETS.length);
  });
  it('按中文名匹配', () => {
    const r = searchStyles('电影感');
    expect(r.some((s) => s.id === 'cinematic')).toBe(true);
  });
  it('按英文名匹配 (大小写不敏感)', () => {
    expect(searchStyles('CINEMATIC').some((s) => s.id === 'cinematic')).toBe(true);
  });
  it('按分类 / 分类中文标签匹配', () => {
    expect(searchStyles('realistic').every((s) => s.category === 'realistic')).toBe(true);
    expect(searchStyles('写实').every((s) => s.category === 'realistic')).toBe(true);
  });
  it('按 promptFragment 关键词匹配', () => {
    expect(searchStyles('anamorphic').some((s) => s.id === 'cinematic')).toBe(true);
  });
  it('无匹配返空', () => {
    expect(searchStyles('zzzzz-no-such-style')).toEqual([]);
  });
});

describe('v6.3 · getPopularStyles (sanity)', () => {
  it('降序 + limit', () => {
    const top3 = getPopularStyles(3);
    expect(top3).toHaveLength(3);
    expect(top3[0].popularity).toBeGreaterThanOrEqual(top3[1].popularity);
  });
});
