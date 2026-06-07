/**
 * v9.6.6 — lib/template-market 单测(T2 模板市场开篇:抽取 / 质量评分 / 检索排序)。
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeElements, scoreTemplate, extractTemplate, rankTemplates, searchTemplates,
  type ExtractTemplateInput,
} from '@/lib/template-market';

describe('v9.6.6 · summarizeElements', () => {
  it('byRole → {role,count}(count>0,固定角色序)', () => {
    const s = summarizeElements({ character: [1, 2] as unknown[], style: [1] as unknown[], scene: [] });
    expect(s).toEqual([{ role: 'character', count: 2 }, { role: 'style', count: 1 }]);
  });
  it('容错 null/空', () => {
    expect(summarizeElements(null)).toEqual([]);
    expect(summarizeElements({})).toEqual([]);
  });
});

describe('v9.6.6 · scoreTemplate', () => {
  it('发布门禁基线', () => {
    expect(scoreTemplate({ publishLevel: 'pass' })).toBe(90);
    expect(scoreTemplate({ publishLevel: 'block' })).toBe(40);
  });
  it('全缺 → 60 中性', () => {
    expect(scoreTemplate({})).toBe(60);
  });
  it('多信号加权归一', () => {
    // 0.5*90 + 0.25*80 + 0.15*100 + 0.10*50 = 85
    expect(scoreTemplate({ publishLevel: 'pass', consistency: 80, completeness: 100, lipSyncReadiness: 50 })).toBe(85);
    // 只有一致性 → 权重归一后 = 该值
    expect(scoreTemplate({ consistency: 80 })).toBe(80);
    // v9.7.15:只有实测对齐 → 归一后 = 该值
    expect(scoreTemplate({ lipAudioAlign: 84 })).toBe(84);
    // 实测对齐拉低总分(pass 90 + 对齐 40,权重 0.5/0.15 → (45+6)/0.65=78.46→78)
    expect(scoreTemplate({ publishLevel: 'pass', lipAudioAlign: 40 })).toBe(78);
  });
});

describe('v9.6.6 · extractTemplate', () => {
  const base: ExtractTemplateInput = {
    id: 't1', title: '  霓虹追逐  ', style: 'American Comic', genre: '热血',
    elements: [{ role: 'character', count: 2 }, { role: 'style', count: 1 }],
    pacingTone: '快节奏', shotCount: 24, signals: { publishLevel: 'pass' }, sourceProjectId: 'p1',
  };
  it('抽取出质量分 + 标签 + 规整字段', () => {
    const t = extractTemplate(base);
    expect(t.quality).toBe(90);
    expect(t.title).toBe('霓虹追逐'); // trim
    expect(t.shotCount).toBe(24);
    expect(t.tags).toEqual(expect.arrayContaining(['American Comic', '热血', '快节奏', '角色', '画风']));
    expect(t.sourceProjectId).toBe('p1');
  });
  it('缺标题 → 未命名模板;count=0 元素剔除', () => {
    const t = extractTemplate({ id: 't2', title: '', style: '国漫', elements: [{ role: 'prop', count: 0 }] });
    expect(t.title).toBe('未命名模板');
    expect(t.elements).toEqual([]);
    expect(t.quality).toBe(60); // 无 signals
  });
});

describe('v9.6.6 · rankTemplates / searchTemplates', () => {
  const mk = (id: string, over: Partial<ExtractTemplateInput>) =>
    extractTemplate({ id, title: id, style: 'anime', shotCount: 10, ...over });
  const templates = [
    mk('low', { signals: { publishLevel: 'block' }, genre: '日常' }),                   // q40
    mk('hi', { signals: { publishLevel: 'pass' }, genre: '热血', title: '热血战斗' }),    // q90
    mk('mid', { signals: { publishLevel: 'warn' }, genre: '热血' }),                     // q70
  ];

  it('rankTemplates 按质量降序', () => {
    expect(rankTemplates(templates).map((t) => t.id)).toEqual(['hi', 'mid', 'low']);
  });
  it('按类型过滤 + 质量排序', () => {
    const r = searchTemplates(templates, { genre: '热血' });
    expect(r.map((t) => t.id)).toEqual(['hi', 'mid']);
  });
  it('最低质量过滤', () => {
    expect(searchTemplates(templates, { minQuality: 80 }).map((t) => t.id)).toEqual(['hi']);
  });
  it('关键词检索(命中标题/标签)→ 相关度优先', () => {
    const r = searchTemplates(templates, { query: '热血' });
    expect(r[0].id).toBe('hi'); // 标题+标签都含「热血」相关度最高
    expect(r.some((t) => t.id === 'low')).toBe(false); // 不含「热血」被滤掉
  });
});
