/**
 * v5.0.1 — 全站 i18n 接线: 新增 key (brand/nav 扩展/dashboard/create.badge/projects 扩展/common 扩展)
 * 在四语言下都存在、非空,且关键词条真做了翻译 (不是简中占位).
 */

import { describe, it, expect } from 'vitest';
import { LOCALES, getTranslations, t, type Locale } from '@/lib/i18n';

// v5.0.1 这批新接线用到的全部叶子路径
const NEW_PATHS = [
  'common.viewAll',
  'common.backHome',
  'brand.studio',
  'nav.polish',
  'nav.workbench',
  'nav.cases',
  'nav.userCenter',
  'nav.newProject',
  'create.badge',
  'projects.createNew',
  'projects.shotsUnit',
  'dashboard.systemOnline',
  'dashboard.title',
  'dashboard.subtitle',
  'dashboard.quickStartTitle',
  'dashboard.quickStartSubtitle',
  'dashboard.statProjects',
  'dashboard.statProjectsSub',
  'dashboard.statGenerations',
  'dashboard.statGenerationsSub',
  'dashboard.statCases',
  'dashboard.statCasesSub',
  'dashboard.recentCreations',
  'dashboard.noRecords',
  'dashboard.startFirst',
  'dashboard.systemStatus',
  'dashboard.recentActivity',
  'dashboard.statusCompleted',
  'dashboard.statusCreating',
  'dashboard.statusDraft',
];

describe('v5.0.1 · 新增 i18n key 四语言完整', () => {
  it('每个新 key 在每种 locale 都非空字符串', () => {
    for (const loc of LOCALES) {
      for (const p of NEW_PATHS) {
        const v = t(loc, p);
        expect(typeof v, `${loc}.${p} type`).toBe('string');
        expect(v.length, `${loc}.${p} non-empty`).toBeGreaterThan(0);
        expect(v, `${loc}.${p} 不应回退成 path 本身`).not.toBe(p);
      }
    }
  });

  it('getTranslations 暴露新 section (brand/dashboard)', () => {
    for (const loc of LOCALES) {
      const tr = getTranslations(loc);
      expect(tr.brand.studio).toBeTruthy();
      expect(tr.dashboard.title).toBeTruthy();
      expect(tr.nav.workbench).toBeTruthy();
      expect(tr.create.badge).toBeTruthy();
      expect(tr.projects.createNew).toBeTruthy();
    }
  });
});

describe('v5.0.1 · 关键词条真翻译 (非简中占位)', () => {
  it('nav.workbench / dashboard.title 各语言不同', () => {
    expect(t('en', 'nav.workbench')).toBe('Workbench');
    expect(t('ja', 'nav.workbench')).toBe('ワークベンチ');
    expect(t('zh-TW', 'dashboard.statusDraft')).toBe('草稿');
    expect(t('ja', 'dashboard.statusDraft')).toBe('下書き');
    expect(t('en', 'projects.shotsUnit')).toBe('shots');
    expect(t('en', 'brand.studio')).toBe('AI Comic Studio');
  });

  it('简繁有别: zh-TW 用繁体字形', () => {
    expect(t('zh-TW', 'nav.userCenter')).toBe('使用者中心'); // 简中是 '用户中心'
    expect(t('zh-CN', 'nav.userCenter')).toBe('用户中心');
  });
});
