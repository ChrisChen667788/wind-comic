/**
 * 阶段二十七 P3 — 宣传片/预告片模板「大脑」单测(纯函数)。
 */
import { describe, expect, it } from 'vitest';
import {
  PROMO_ARCS,
  getPromoArc,
  scalePromoSequence,
  buildPromoPlan,
  buildPromoStructureHint,
  PROMO_TEMPLATES,
  PROMO_EDIT_STYLE,
} from '@/lib/promo-template';
import { storyTemplates, getTemplateById } from '@/lib/story-templates';

describe('scalePromoSequence', () => {
  const arc = getPromoArc('product-launch')!;
  it('永远 hook 开头、cta 结尾', () => {
    for (const n of [3, 5, 8, 12]) {
      const seq = scalePromoSequence(arc, n);
      expect(seq[0]).toBe('hook');
      expect(seq[seq.length - 1]).toBe('cta');
    }
  });
  it('镜数夹到 [3,12]', () => {
    expect(scalePromoSequence(arc, 1).length).toBe(3);
    expect(scalePromoSequence(arc, 99).length).toBe(12);
    expect(scalePromoSequence(arc, 6).length).toBe(6);
  });
  it('镜数富裕时补 value 卖点镜', () => {
    const seq = scalePromoSequence(getPromoArc('brand-teaser')!, 10);
    expect(seq.length).toBe(10);
    expect(seq.filter((r) => r === 'value').length).toBeGreaterThanOrEqual(6);
  });
  it('确定性:同输入同输出', () => {
    expect(scalePromoSequence(arc, 7)).toEqual(scalePromoSequence(arc, 7));
  });
});

describe('buildPromoPlan', () => {
  it('结构正确 + 总时长 = 镜数×单镜秒', () => {
    const p = buildPromoPlan('一句话生成整部短剧的 AI 制作台', 'product-launch', { shotCount: 6, perShotSec: 5 });
    expect(p.shots.length).toBe(6);
    expect(p.shots[0].role).toBe('hook');
    expect(p.shots[5].role).toBe('cta');
    expect(p.totalSec).toBe(30);
    expect(p.editStyle).toBe(PROMO_EDIT_STYLE);
    expect(p.aspect).toBe('16:9');
    expect(p.shots.every((s) => s.intent.length > 0 && s.suggestedLine.length > 0)).toBe(true);
  });
  it('未知 arc 回退到第一套;brief 注入卖点文案', () => {
    const p = buildPromoPlan('神级 AI 引擎', 'nope');
    expect(p.arcId).toBe(PROMO_ARCS[0].id);
    expect(p.shots.some((s) => s.role === 'value' && s.suggestedLine.includes('神级 AI 引擎'))).toBe(true);
  });
});

describe('buildPromoStructureHint', () => {
  it('含促销纪律关键词且足够长(满足模板字段校验 > 50)', () => {
    const h = buildPromoStructureHint('product-launch');
    expect(h.length).toBeGreaterThan(50);
    expect(h).toMatch(/钩子/);
    expect(h).toMatch(/CTA/);
    expect(h).toMatch(/卖点/);
  });
});

describe('PROMO_TEMPLATES 已注册进 storyTemplates', () => {
  it('两套促销模板存在且字段合法', () => {
    expect(PROMO_TEMPLATES.length).toBe(2);
    for (const t of PROMO_TEMPLATES) {
      expect(getTemplateById(t.id)).toBeDefined();           // 已 spread 进注册表
      expect(t.id).toMatch(/^[a-z-]+$/);
      expect(t.structureHint.length).toBeGreaterThan(50);
      expect(t.exampleIdea.length).toBeGreaterThanOrEqual(20);
      expect(['push-in', 'crash-zoom']).toContain(t.recommendedCamera);
    }
  });
  it('id 唯一(不与现有 18 套冲突)', () => {
    const ids = storyTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(storyTemplates.length).toBeGreaterThanOrEqual(20);
  });
});
