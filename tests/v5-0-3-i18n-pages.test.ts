/**
 * v5.0.3 — 剩余页面接 i18n: settings/profile/billing/cases 段 + common 扩
 * 四语言完整 + 关键词条真翻译.
 */

import { describe, it, expect } from 'vitest';
import { LOCALES, getTranslations, t } from '@/lib/i18n';

const NEW_PATHS = [
  'common.saveChanges', 'common.saving', 'common.reset',
  // settings (全 key)
  'settings.title', 'settings.subtitle', 'settings.general', 'settings.generalDesc',
  'settings.language', 'settings.appearance', 'settings.appearanceDesc', 'settings.theme',
  'settings.themeDark', 'settings.themeLight', 'settings.themeAuto',
  'settings.notifications', 'settings.notificationsDesc', 'settings.projectDone', 'settings.projectDoneDesc',
  'settings.performance', 'settings.performanceDesc', 'settings.videoQuality',
  'settings.qualityHigh', 'settings.qualityMedium', 'settings.qualityLow',
  'settings.privacy', 'settings.privacyDesc', 'settings.changePassword', 'settings.enable2fa', 'settings.manageDevices',
  'settings.billing', 'settings.billingDesc', 'settings.freePlan', 'settings.currentPlan', 'settings.freeQuota', 'settings.upgradePro',
  'settings.saved', 'settings.savedDesc', 'settings.resetDone',
  // profile
  'profile.title', 'profile.subtitle', 'profile.avatar', 'profile.uploadAvatar',
  'profile.basicInfo', 'profile.basicInfoDesc', 'profile.username', 'profile.email', 'profile.bio', 'profile.bioPlaceholder',
  'profile.stats', 'profile.totalProjects', 'profile.inProgress', 'profile.totalShots',
  'profile.saveSuccess', 'profile.saveSuccessDesc', 'profile.role', 'profile.accountPrefs', 'profile.visualPref', 'profile.collabSpace',
  // billing
  'billing.title', 'billing.currentTier', 'billing.paymentNote', 'billing.recommended', 'billing.currentBadge',
  'billing.contactUs', 'billing.perMonth', 'billing.alreadyThis', 'billing.freeNoPurchase', 'billing.businessTalk',
  'billing.upgradeTo', 'billing.portalNote', 'billing.openPortal', 'billing.checkoutFailed', 'billing.paymentCanceled',
  'billing.upgradedPrefix', 'billing.upgradedSuffix',
  // cases
  'cases.title', 'cases.titlePublic', 'cases.subtitle', 'cases.subtitleReuse', 'cases.copyPrompt', 'cases.copied', 'cases.usePrompt',
];

describe('v5.0.3 · settings/profile/billing/cases 段四语言完整', () => {
  it('每个新 key 在每种 locale 都非空且不回退成 path', () => {
    for (const loc of LOCALES) {
      for (const p of NEW_PATHS) {
        const v = t(loc, p);
        expect(typeof v, `${loc}.${p} type`).toBe('string');
        expect(v.length, `${loc}.${p} non-empty`).toBeGreaterThan(0);
        expect(v, `${loc}.${p} 不应回退成 path`).not.toBe(p);
      }
    }
  });

  it('getTranslations 暴露四个新 section', () => {
    for (const loc of LOCALES) {
      const tr = getTranslations(loc);
      expect(tr.settings.title).toBeTruthy();
      expect(tr.profile.title).toBeTruthy();
      expect(tr.billing.title).toBeTruthy();
      expect(tr.cases.title).toBeTruthy();
    }
  });
});

describe('v5.0.3 · 关键词条真翻译', () => {
  it('settings/profile 各语言用对应语言', () => {
    expect(t('en', 'settings.title')).toBe('Settings');
    expect(t('ja', 'settings.title')).toBe('設定');
    expect(t('en', 'profile.username')).toBe('Username');
    expect(t('ja', 'profile.bio')).toBe('自己紹介');
    expect(t('en', 'billing.recommended')).toBe('Recommended');
    expect(t('en', 'cases.copyPrompt')).toBe('Copy Prompt');
  });

  it('简繁有别', () => {
    expect(t('zh-CN', 'settings.appearance')).toBe('外观'); // 简
    expect(t('zh-TW', 'settings.appearance')).toBe('外觀'); // 繁
    expect(t('zh-CN', 'profile.username')).toBe('用户名');
    expect(t('zh-TW', 'profile.username')).toBe('使用者名稱');
  });
});
