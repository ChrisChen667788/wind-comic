/**
 * v5.0.4 — 收尾页接 i18n: home/pricing/help/examples 段 (含数组 frameSteps/faq/guides/faqs)
 * 四语言完整 + 关键词条真翻译.
 */

import { describe, it, expect } from 'vitest';
import { LOCALES, getTranslations, t } from '@/lib/i18n';

const SCALAR_PATHS = [
  // home
  'home.heroTagline1', 'home.heroTagline2', 'home.heroCtaCreate', 'home.heroCtaCases',
  'home.featureTitle', 'home.featureSubtitle', 'home.agentsTitle', 'home.agentsSubtitle',
  'home.lensCaption', 'home.lensTitle', 'home.lensDesc',
  'home.frameTitle', 'home.frameSubtitle', 'home.frameCta',
  'home.vibeKicker', 'home.vibeTitle', 'home.vibeDesc',
  'home.casesTitle', 'home.casesSubtitle', 'home.casesTryNow',
  'home.ctaTitle', 'home.ctaDesc', 'home.ctaButton',
  // pricing
  'pricing.enterWorkbench', 'pricing.badge', 'pricing.titleLead', 'pricing.titleHighlight',
  'pricing.subtitle', 'pricing.custom', 'pricing.customNote', 'pricing.free', 'pricing.startUsing',
  'pricing.apiAccess', 'pricing.commercialLicense', 'pricing.footnote', 'pricing.faqTitle',
  'pricing.moreTitle', 'pricing.moreDesc', 'pricing.contactSupport', 'pricing.alertPayment',
  // help
  'help.examples', 'help.title', 'help.subtitle', 'help.searchPlaceholder', 'help.quickGuides',
  'help.faqTitle', 'help.moreTitle', 'help.moreDesc', 'help.sendEmail', 'help.liveChat',
  // examples
  'examples.title', 'examples.subtitle', 'examples.ctaTitle', 'examples.ctaDesc', 'examples.ctaButton',
];

describe('v5.0.4 · home/pricing/help/examples 段四语言完整', () => {
  it('标量 key 在每种 locale 都非空且不回退成 path', () => {
    for (const loc of LOCALES) {
      for (const p of SCALAR_PATHS) {
        const v = t(loc, p);
        expect(typeof v, `${loc}.${p} type`).toBe('string');
        expect(v.length, `${loc}.${p} non-empty`).toBeGreaterThan(0);
        expect(v, `${loc}.${p} 不应回退成 path`).not.toBe(p);
      }
    }
  });

  it('数组结构 (frameSteps/faq/guides/faqs) 四语言长度一致且每条非空', () => {
    const base = getTranslations('zh-CN');
    for (const loc of LOCALES) {
      const tr = getTranslations(loc);
      expect(tr.home.frameSteps.length, `${loc} frameSteps len`).toBe(base.home.frameSteps.length);
      expect(tr.pricing.faq.length, `${loc} pricing.faq len`).toBe(base.pricing.faq.length);
      expect(tr.help.guides.length, `${loc} help.guides len`).toBe(base.help.guides.length);
      expect(tr.help.faqs.length, `${loc} help.faqs len`).toBe(base.help.faqs.length);
      tr.home.frameSteps.forEach((s, i) => {
        expect(s.title.length, `${loc} frameSteps[${i}].title`).toBeGreaterThan(0);
        expect(s.desc.length, `${loc} frameSteps[${i}].desc`).toBeGreaterThan(0);
      });
      tr.pricing.faq.forEach((f, i) => {
        expect(f.q.length, `${loc} pricing.faq[${i}].q`).toBeGreaterThan(0);
        expect(f.a.length, `${loc} pricing.faq[${i}].a`).toBeGreaterThan(0);
      });
      tr.help.faqs.forEach((f, i) => {
        expect(f.q.length, `${loc} help.faqs[${i}].q`).toBeGreaterThan(0);
        expect(f.a.length, `${loc} help.faqs[${i}].a`).toBeGreaterThan(0);
      });
    }
  });
});

describe('v5.0.4 · 关键词条真翻译', () => {
  it('home/pricing 各语言用对应语言', () => {
    expect(t('en', 'home.ctaButton')).toBe('Enter Workbench');
    expect(t('ja', 'home.frameCta')).toBe('絵コンテを生成');
    expect(t('en', 'pricing.badge')).toBe('Pricing');
    expect(t('en', 'examples.ctaButton')).toBe('Start Creating Now');
  });

  it('简繁有别', () => {
    expect(t('zh-CN', 'help.title')).toBe('帮助中心');
    expect(t('zh-TW', 'help.title')).toBe('說明中心');
  });

  it('FAQ 数组内容真翻译 (en 与 zh-CN 不同)', () => {
    const en = getTranslations('en');
    const zh = getTranslations('zh-CN');
    expect(en.pricing.faq[0].a).not.toBe(zh.pricing.faq[0].a);
    expect(en.help.faqs[0].q).not.toBe(zh.help.faqs[0].q);
  });
});
