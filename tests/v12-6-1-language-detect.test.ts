/**
 * v12.6.1(#2)— 目标语种检测 + 贯穿约束。
 */
import { describe, it, expect } from 'vitest';
import { detectLanguage, ttsLangCode, lipsyncLangCode, buildLanguageDirective } from '@/lib/language-detect';

describe('v12.6.1 · detectLanguage', () => {
  it('中文创意 → zh(含少量英文品牌名也判中文)', () => {
    expect(detectLanguage('暮色城市霓虹雨夜,失忆旅人追查身世')).toBe('zh');
    expect(detectLanguage('第 1 章 绿皮书之约 粗鲁的意大利裔保镖 Tony Lip')).toBe('zh');
  });
  it('纯英文创意 → en', () => {
    expect(detectLanguage('A cyberpunk detective chases a hacker in the neon rain')).toBe('en');
  });
  it('空/无字母 → 默认 zh', () => {
    expect(detectLanguage('')).toBe('zh');
    expect(detectLanguage('   123 ... !!! ')).toBe('zh');
  });
  it('英文为主夹个别中文字 → en', () => {
    expect(detectLanguage('A long english story about a hero, 龙')).toBe('en');
  });
});

describe('v12.6.1 · 语种码映射', () => {
  it('ttsLangCode', () => {
    expect(ttsLangCode('zh')).toBe('zh-CN');
    expect(ttsLangCode('en')).toBe('en-US');
  });
  it('lipsyncLangCode', () => {
    expect(lipsyncLangCode('zh')).toBe('zh');
    expect(lipsyncLangCode('en')).toBe('en');
  });
});

describe('v12.6.1 · buildLanguageDirective', () => {
  it('zh:锁中文台词,visualPrompt 仍英文', () => {
    const d = buildLanguageDirective('zh');
    expect(d).toContain('简体中文');
    expect(d).toContain('visualPrompt');
  });
  it('en:lock English dialogue', () => {
    const d = buildLanguageDirective('en');
    expect(d).toContain('ENGLISH');
    expect(d.toLowerCase()).toContain('dialogue');
  });
});
