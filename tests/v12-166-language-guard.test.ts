/**
 * v12.166 — 剧本语种守门:检测/判定纯函数 + 双保险接线锁。
 */
import { describe, it, expect } from 'vitest';
import { textMatchesLanguage, scriptLanguageMismatch, needsLanguageFix, buildLanguageFixPrompt } from '@/lib/language-guard';
import fs from 'fs';

describe('v12.166 · textMatchesLanguage', () => {
  it('日语必含假名;纯汉字判不符;韩俄按主体字符', () => {
    expect(textMatchesLanguage('静けさこそ、力だ。', 'ja')).toBe(true);
    expect(textMatchesLanguage('续航够。828公里', 'ja')).toBe(false);   // live 事故样本
    expect(textMatchesLanguage('엄마, 봐! 빛이야!', 'ko')).toBe(true);
    expect(textMatchesLanguage('Тишина — это сила', 'ru')).toBe(true);
    expect(textMatchesLanguage('妈妈你看!光!', 'ru')).toBe(false);
    expect(textMatchesLanguage('OK!', 'ja')).toBe(true);              // 太短不判
    expect(textMatchesLanguage('見ない。心动就试试静寂の光,下一个惊喜是你。', 'ja')).toBe(false); // live 混语句
    expect(textMatchesLanguage('航続は十分だ、まだ828キロ走れる。', 'ja')).toBe(true);
    expect(textMatchesLanguage('', 'ja')).toBe(true);
  });
  it('needsLanguageFix:过半不符才修;zh 永不修;样本<2 不修', () => {
    const badJa = { shots: [{ dialogue: '我们试试看' }, { dialogue: '续航够。828公里' }, { narration: '妈妈你看' }] };
    expect(needsLanguageFix(badJa, 'ja')).toBe(true);
    const goodJa = { shots: [{ dialogue: '行ってみよう' }, { dialogue: '航続は十分。828キロ' }] };
    expect(needsLanguageFix(goodJa, 'ja')).toBe(false);
    expect(needsLanguageFix(badJa, 'zh')).toBe(false);
    expect(needsLanguageFix({ shots: [{ dialogue: '短' }] }, 'ja')).toBe(false);
    const m = scriptLanguageMismatch(badJa, 'ja');
    expect(m.checked).toBe(3); expect(m.mismatched).toBe(3);
  });
  it('修复 prompt:只翻文案字段、结构保留、只回 JSON', () => {
    const p = buildLanguageFixPrompt('Japanese', '日本語');
    expect(p).toContain('dialogue');
    expect(p).toContain('byte-identical');
    expect(p).toContain('Japanese');
  });
  // v12.263:把原「grep writer-agent 含某字符串」的接线锁,升级为**真行为断言** ——
  // ④ 抽离让 runWriter 成了可注入 ctx 的独立函数,得以真跑并验证「目标语种≠中文 → user 端注语言铁律」。
  it('行为:runWriter 在目标语种≠中文时把语言铁律注入 LLM user 消息', async () => {
    const { runWriter } = await import('@/services/agents/writer-agent');
    const plan: any = {
      theme: 't', genre: '剧情', style: '写实', logline: 'x', synopsis: 'x',
      characters: [{ name: '张三', appearance: '青年男性' }],
      scenes: [{ location: '室内', description: 's', dialogues: [] }],
      storyStructure: { totalShots: 4 },
    };
    const mkCtx = (lang: string) => {
      const calls: Array<{ sys: string; usr: string }> = [];
      const ctx: any = {
        parsedScript: null, originalIdea: 't', projectId: '', template: null,
        characterAppearanceMap: {}, qualityLedger: [], openai: {},
        emit: () => {}, update: () => {},
        callLLM: (sys: string, usr: string) => { calls.push({ sys, usr }); return Promise.resolve(''); },
        fallbackScript: () => ({ title: 'fb', shots: [] }),
        targetLanguage: () => lang,
      };
      return { ctx, calls };
    };
    // ja:user 消息应含语言铁律(buildLanguageDirective 非中文分支的 `OUTPUT LANGUAGE` 标题)
    const ja = mkCtx('ja');
    await runWriter(ja.ctx, plan).catch(() => { /* 只验注入,不关心是否跑完 */ });
    expect(ja.calls.some((c) => typeof c.usr === 'string' && c.usr.includes('OUTPUT LANGUAGE'))).toBe(true);
    // zh:user 端不额外注(system 端另有;user 端仅非中文时注)
    const zh = mkCtx('zh');
    await runWriter(zh.ctx, plan).catch(() => {});
    expect(zh.calls.some((c) => typeof c.usr === 'string' && c.usr.includes('OUTPUT LANGUAGE'))).toBe(false);
  });

  it('接线锁:startProduction 产后语言守门(仍在 orchestrator)', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('needsLanguageFix(script, this._targetLanguage)');
    expect(src).toContain('本地化为');
  });
});
