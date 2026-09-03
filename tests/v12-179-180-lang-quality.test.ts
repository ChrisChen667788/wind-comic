/**
 * v12.179/180 — 口型语种诚实降级 + 字幕字体跨平台。
 */
import { describe, it, expect } from 'vitest';
import { lipsyncLangCode } from '@/lib/language-detect';
import { fontForLanguage, buildSubtitlesFilter } from '@/lib/subtitle-burn';
import fs from 'fs';

describe('v12.179 · 口型语种', () => {
  it('ko/ru/ja → none(错口型比无口型更伤);zh/en 保留', () => {
    expect(lipsyncLangCode('ko')).toBe('none');
    expect(lipsyncLangCode('ru')).toBe('none');
    expect(lipsyncLangCode('ja')).toBe('none'); // v12.196:日语音素差距不亚于韩俄,跟进降级
    expect(lipsyncLangCode('zh')).toBe('zh');
    expect(lipsyncLangCode('en')).toBe('en');
  });
  it('接线锁:没有合适引擎时必须跳过口型(锁行为,不锁写法)', async () => {
    // v12.418:此前这条断言 `o).toContain("lsLang === 'none'")` —— 锁的是**那一行写法**。
    // 而 v12.418 把判定从「只看语言」改成「语言 × 当前装了什么引擎」
    //(Sync.so 是语种无关的,配了它 ja/ko/ru 就该解开),行为更准了,这条却红了。
    // 与 v12.122 / v9.4.4 那两条是同一个毛病:锁写法,重构一次红一次。
    // 改成直接过生产判定函数。
    const { decideLipsyncForLanguage } = await import('@/lib/lipsync-language-gate');
    const prev = process.env.SYNCSO_API_KEY;
    try {
      delete process.env.SYNCSO_API_KEY;
      for (const lang of ['ja', 'ko', 'ru'] as const) {
        const d = decideLipsyncForLanguage(lang);
        expect(d.enabled, `${lang} 没有合适引擎时不该上口型`).toBe(false);
        expect(d.reason, '要说清为什么跳过').toMatch(/错口型比无口型更伤|诚实降级/);
      }
      expect(decideLipsyncForLanguage('zh').enabled).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SYNCSO_API_KEY;
      else process.env.SYNCSO_API_KEY = prev;
    }

    // 消费方确实接了这条判定(而不是各自再判一遍)
    const consumers = ['services/agents/editor-agent.ts', 'lib/engine-capability-notes.ts']
      .map((f) => fs.readFileSync(f, 'utf-8')).join('');
    expect(consumers).toContain('decideLipsyncForLanguage(');
  });
});

describe('v12.180 · 字幕字体', () => {
  it('SUBTITLE_FONT env 最优先;语种映射按平台;非 darwin 用 Noto 系', () => {
    expect(fontForLanguage('ko', 'PingFang SC', { SUBTITLE_FONT: 'MyFont' })).toBe('MyFont');
    const linuxKo = fontForLanguage('ko', 'PingFang SC', {});
    expect([ 'Noto Sans KR', 'Apple SD Gothic Neo' ]).toContain(linuxKo!);
    const zhF = fontForLanguage('zh', 'PingFang SC', {});
    expect(['PingFang SC', 'Noto Sans CJK SC']).toContain(zhF!);
  });
  it('CI 等价:Linux 平台语义(darwin 本地跑不出的分支)', () => {
    expect(fontForLanguage(undefined, 'Arial', {}, 'linux')).toBeNull();      // 未指定语种不覆盖 —— CI 抓到的真 bug
    expect(fontForLanguage('zh', 'PingFang SC', {}, 'linux')).toBe('Noto Sans CJK SC');
    expect(fontForLanguage('ko', 'PingFang SC', {}, 'linux')).toBe('Noto Sans KR');
    expect(fontForLanguage('ru', 'PingFang SC', {}, 'linux')).toBe('DejaVu Sans');
    expect(fontForLanguage(undefined, 'Arial', {}, 'darwin')).toBeNull();
  });
  it('buildSubtitlesFilter 带 lang 参数换字体;显式 override 优先', () => {
    const ko = buildSubtitlesFilter('/tmp/a.srt', 'douyin', {}, 'ko');
    expect(ko).toMatch(/FontName=(Noto Sans KR|Apple SD Gothic Neo)/);
    const ov = buildSubtitlesFilter('/tmp/a.srt', 'douyin', { fontName: 'Custom' }, 'ko');
    expect(ov).toContain('FontName=Custom');
  });
});
