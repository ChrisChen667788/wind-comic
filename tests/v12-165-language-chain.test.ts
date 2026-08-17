/**
 * v12.164/165 — 遗留双修 + 语言体系全链:纯函数 + 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { getSystemLanguage, setSystemLanguage } from '@/lib/system-language';
import { buildShortVideoMessages } from '@/lib/short-video';
import { getRhythmTemplate } from '@/lib/short-video';
import { normalizeLanguage, languageDisplayName, ttsLangCode } from '@/lib/language-detect';
import fs from 'fs';

describe('v12.164 · 遗留双修', () => {
  // v12.263:grep→真行为。④ 让 runWriter 可注入 ctx,得以真跑并验证 Pass2 的**实际** LLM 调用参数
  //(user 消息含输出预算铁律 + maxTokens 提档到 24576),而非 grep 源码字符串。
  it('行为:Writer Pass2 注入输出预算铁律 + maxTokens 提档 24576', async () => {
    const { runWriter } = await import('@/services/agents/writer-agent');
    const plan: any = {
      theme: 't', genre: '剧情', style: '写实', logline: 'x', synopsis: 'x',
      characters: [{ name: '张三', appearance: '青年男性' }],
      scenes: [{ location: '室内', description: 's', dialogues: [] }],
      storyStructure: { totalShots: 4 },
    };
    const calls: Array<{ usr: string; opts: any }> = [];
    const ctx: any = {
      parsedScript: null, originalIdea: 't', projectId: '', template: null,
      characterAppearanceMap: {}, qualityLedger: [], openai: {},
      emit: () => {}, update: () => {},
      callLLM: (_sys: string, usr: string, _json?: boolean, _cr?: boolean, opts?: any) => { calls.push({ usr, opts }); return Promise.resolve(''); },
      fallbackScript: () => ({ title: 'fb', shots: [] }),
      targetLanguage: () => 'zh',
    };
    await runWriter(ctx, plan).catch(() => { /* 只验 Pass2 调用参数 */ });
    expect(calls.some((c) => typeof c.usr === 'string' && c.usr.includes('输出预算铁律'))).toBe(true);
    expect(calls.some((c) => c.opts?.maxTokens === 24576)).toBe(true);
  });
  it('网关 401 也进冷却(key 失效不再每镜撞)', () => {
    const src = (fs.readFileSync('services/hybrid-orchestrator.ts','utf-8')+fs.readFileSync('services/agents/writer-agent.ts','utf-8')+fs.readFileSync('services/agents/editor-agent.ts','utf-8'));
    expect((src.match(/res\.status === 401 \|\| res\.status === 402/g) || []).length).toBe(2);
  });
});

describe('v12.165 · 语言体系', () => {
  it('俄日韩语种注册完整:归一/展示名/TTS 语码', () => {
    for (const [alias, code, tts] of [['俄语', 'ru', 'ru-RU'], ['日本語', 'ja', 'ja-JP'], ['korean', 'ko', 'ko-KR']] as const) {
      const norm = normalizeLanguage(alias, '');
      expect(norm).toBe(code);
      expect(ttsLangCode(norm)).toBe(tts);
      expect(languageDisplayName(norm)).toBeTruthy();
    }
  });
  it('系统默认语言:SSR 安全返回 auto(node 环境无 localStorage)', () => {
    expect(getSystemLanguage()).toBe('auto');
    expect(() => setSystemLanguage('ru')).not.toThrow();
  });
  it('短视频 planner:language 注入语言铁律;不传不注入', () => {
    const rhythm = getRhythmTemplate(undefined);
    const withLang = buildShortVideoMessages({ idea: 'test', style: '', durationS: 15, rhythm, language: 'Русский' });
    expect(withLang.system).toContain('语言铁律');
    expect(withLang.system).toContain('Русский');
    const noLang = buildShortVideoMessages({ idea: 'test', style: '', durationS: 15, rhythm });
    expect(noLang.system).not.toContain('语言铁律');
  });
  it('接线锁:series generate 复用已读 body 透传 language;创作页/短视频挂选择器;系列面板带系统语言', () => {
    const gen = fs.readFileSync('app/api/series/[id]/generate/route.ts', 'utf-8');
    expect(gen).toContain("body?.language === 'string'");
    expect(gen).not.toContain('reqBody = await request.json'); // 禁二次读 body
    expect(gen).toContain('language, // v12.165');
    expect(fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8')).toContain('<LanguagePicker');
    expect(fs.readFileSync('app/dashboard/short-video/page.tsx', 'utf-8')).toContain('sv-language');
    expect(fs.readFileSync('app/dashboard/series/[id]/page.tsx', 'utf-8')).toContain('language: getSystemLanguage()');
    expect(fs.readFileSync('app/api/short-video/plan/route.ts', 'utf-8')).toContain('languageDisplayName');
  });
  it('TTS 下达链:orchestrator 配音按 targetLanguage 的 ttsLangCode', () => {
    const src = (fs.readFileSync('services/hybrid-orchestrator.ts','utf-8')+fs.readFileSync('services/agents/writer-agent.ts','utf-8')+fs.readFileSync('services/agents/editor-agent.ts','utf-8'));
    expect(src).toContain('ttsLangCode(ctx.targetLanguage())');
  });
});
