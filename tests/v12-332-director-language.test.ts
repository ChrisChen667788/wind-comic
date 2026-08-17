/**
 * v12.332 — v12.322 的**幸存部分**:导演也要知道目标语种。
 *
 * ── 为什么这个文件存在 ────────────────────────────────────────────
 * v12.322 修了两件事:① XVerse 编剧收不到语种;② **两条导演路径都收不到语种**。
 * 本版删除 XVerse 时,原测试文件 `v12-322-xverse-language.test.ts` 随之删掉 ——
 * 但那里面有一半锁的是**第 ② 件事,而它仍然存在**:自家 LLM 的导演路径依旧要
 * 挂语种铁律。**删掉一个供应商,不该顺手把与它无关的守护一起丢掉**,否则这条
 * 修复会在某次重构里悄悄退回去,而没有任何测试会红。
 *
 * ── 被守护的行为 ──────────────────────────────────────────────────
 * 导演产出的场景描述 / 故事结构**正是 Writer 的素材**。素材是中文却要求 Writer
 * 写英文,等于让它边翻译边创作 —— 这也是 v12.166 那道事后语种守门频繁触发的
 * 真正原因。所以导演提示词必须挂 `buildLanguageDirective`。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildLanguageDirective } from '@/lib/language-detect';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ORCH = strip(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8'));
const WRITER = strip(fs.readFileSync('services/agents/writer-agent.ts', 'utf-8'));

describe('v12.332 · 导演路径的语种指令(v12.322 的幸存部分)', () => {
  it('导演系统提示词挂了语种铁律', () => {
    const i = ORCH.indexOf('const directorSystemPrompt = getDirectorSystemPrompt');
    expect(i, '找不到导演提示词构造点').toBeGreaterThan(0);
    expect(ORCH.slice(i, i + 400)).toContain('buildLanguageDirective(this.targetLanguage())');
  });

  it('Writer 侧也仍然传语种(自家 LLM 那条,v12.6.1 起的口径)', () => {
    expect(WRITER).toContain('language: ctx.targetLanguage()');
  });
});

describe('v12.332 · 语种指令本身的约定未被改坏', () => {
  it('**visualPrompt 仍留英文** —— 混中文会被引擎渲染成画面文字(v2.22 的坑)', () => {
    for (const lang of ['zh', 'en'] as const) {
      expect(buildLanguageDirective(lang)).toMatch(/visualPrompt/);
    }
    expect(buildLanguageDirective('zh')).toMatch(/仍用英文|英文/);
  });

  it('非中文给的是硬性要求,不是「尽量」', () => {
    const en = buildLanguageDirective('en');
    expect(en).toMatch(/MUST/);
    expect(en).toMatch(/Do NOT output Chinese/i);
  });
});

describe('v12.332 · 事后语种守门仍在(前置说清楚 ≠ 模型一定照做)', () => {
  it('v12.166 的守门保留为兜底', () => {
    expect(ORCH).toContain('needsLanguageFix');
    expect(ORCH).toContain('buildLanguageFixPrompt');
  });

  it('修不好时保留原稿并告警,不是静默丢弃', () => {
    expect(ORCH).toMatch(/LangGuard[^\n]*保留原稿/);
  });
});
