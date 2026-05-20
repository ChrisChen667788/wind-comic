/**
 * v5.0 — i18n 单测: 翻译完整性 + 回退 + locale 解析.
 */

import { describe, it, expect } from 'vitest';
import {
  LOCALES,
  LOCALE_LABELS,
  getTranslations,
  normalizeLocale,
  resolveLocaleFromHeader,
  t,
  type Locale,
} from '@/lib/i18n';

// 收集对象所有叶子点路径
function leafPaths(obj: any, prefix = ''): string[] {
  const out: string[] = [];
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (obj[k] && typeof obj[k] === 'object') out.push(...leafPaths(obj[k], p));
    else out.push(p);
  }
  return out;
}

describe('v5.0 · 翻译完整性', () => {
  const basePaths = leafPaths(getTranslations('zh-CN')).sort();

  it('every locale has all zh-CN keys, all non-empty strings', () => {
    for (const loc of LOCALES) {
      const tr = getTranslations(loc);
      const paths = leafPaths(tr).sort();
      expect(paths, `locale ${loc} key set`).toEqual(basePaths);
      for (const p of basePaths) {
        const v = t(loc, p);
        expect(typeof v, `${loc}.${p} type`).toBe('string');
        expect(v.length, `${loc}.${p} non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it('zh-TW / ja are real translations (differ from zh-CN on key terms)', () => {
    // 之前是 zhCN 占位 — 现在应不同
    expect(t('zh-TW', 'common.save')).toBe('儲存');     // 简中是 '保存'
    expect(t('ja', 'common.save')).toBe('保存');
    expect(t('ja', 'common.cancel')).toBe('キャンセル');
    expect(t('zh-TW', 'nav.projects')).toBe('我的專案');
  });

  it('LOCALE_LABELS covers every locale', () => {
    for (const loc of LOCALES) expect(LOCALE_LABELS[loc]).toBeTruthy();
  });
});

describe('v5.0 · normalizeLocale', () => {
  const cases: Array<[string, Locale]> = [
    ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'], ['zh-Hans', 'zh-CN'],
    ['zh-TW', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-HK', 'zh-TW'], ['ZH-tw', 'zh-TW'],
    ['en', 'en'], ['en-US', 'en'], ['EN-GB', 'en'],
    ['ja', 'ja'], ['ja-JP', 'ja'],
    ['', 'zh-CN'], ['fr', 'zh-CN'], ['de-DE', 'zh-CN'],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected}`, () => expect(normalizeLocale(input)).toBe(expected));
  }
  it('null/undefined → zh-CN', () => {
    expect(normalizeLocale(null)).toBe('zh-CN');
    expect(normalizeLocale(undefined)).toBe('zh-CN');
  });
});

describe('v5.0 · resolveLocaleFromHeader', () => {
  it('picks highest-q supported language', () => {
    expect(resolveLocaleFromHeader('ja,en;q=0.8,zh;q=0.5')).toBe('ja');
    expect(resolveLocaleFromHeader('fr;q=0.9,en;q=0.8')).toBe('en'); // 跳过不支持的 fr
    expect(resolveLocaleFromHeader('zh-TW,zh;q=0.9')).toBe('zh-TW');
  });
  it('unsupported-only → zh-CN', () => {
    expect(resolveLocaleFromHeader('fr,de;q=0.8')).toBe('zh-CN');
  });
  it('empty → zh-CN', () => {
    expect(resolveLocaleFromHeader('')).toBe('zh-CN');
    expect(resolveLocaleFromHeader(null)).toBe('zh-CN');
  });
});

describe('v5.0 · t() fallback', () => {
  it('falls back to zh-CN path value, then path string', () => {
    expect(t('en', 'common.save')).toBe('Save');
    // 不存在的 path → 返回 path 本身 (不崩)
    expect(t('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
});

describe('v5.0 · getTranslations deep-merge safety', () => {
  it('returns full structure for each locale', () => {
    for (const loc of LOCALES) {
      const tr = getTranslations(loc);
      expect(tr.common.save).toBeTruthy();
      expect(tr.nav.projects).toBeTruthy();
      expect(tr.create.startButton).toBeTruthy();
      expect(tr.projects.filterAll).toBeTruthy();
    }
  });
});
