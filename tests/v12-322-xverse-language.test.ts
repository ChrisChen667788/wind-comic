/**
 * v12.322 — 非中文项目走 XVerse 时拿到中文剧本(本仓最久的一处 i18n 漏洞)。
 *
 * ── 病象 ──────────────────────────────────────────────────────────
 * 自家 LLM 那条路从 **v12.6.1** 起就把目标语种传给 Writer(`language` +
 * `buildLanguageDirective`)。而 XVerse 这条:
 *   · `WriteScriptOptions` **根本没有 language 字段** —— 服务层无从得知;
 *   · Pass 1 的提示词把身份写死成「精通分镜的**中文**编剧」—— 连角色设定
 *     都在把模型往中文带;
 *   · Pass 2 的系统提示词不含任何语种铁律。
 * 于是非中文项目走 XVerse 必出中文剧本。
 *
 * ── 为什么「已经有事后守门」不算已修 ──────────────────────────────
 * v12.166 加过一道守门:成稿后检测语种偏离 → 再调一次 LLM 整篇回译。它是**兜底,
 * 不是解法**:多花一次全量 LLM 调用(整份剧本进出),而且它自己写着
 * 「修复失败保留原稿」—— 也就是说**英文项目可能就这么带着中文剧本走下去**,
 * 字幕、配音、口型全部跟着错。事前说清楚,比事后翻译便宜也可靠得多。
 *
 * ── 同批的上游一处 ────────────────────────────────────────────────
 * 修 Writer 还不够:**导演产出的场景描述/故事结构正是 Writer 的素材**。
 * 两条导演路径(自家 LLM 与 XVerse)此前都不知道语种,素材是中文却要求 Writer
 * 写英文,等于让它边翻译边创作 —— 这也是事后守门频繁触发的真正原因。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildLanguageDirective } from '@/lib/language-detect';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const XV = strip(fs.readFileSync('services/xverse.service.ts', 'utf-8'));
const WRITER = strip(fs.readFileSync('services/agents/writer-agent.ts', 'utf-8'));
const ORCH = strip(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8'));

describe('v12.322 · XVerse 编剧终于知道目标语种', () => {
  it('WriteScriptOptions 有 language 字段', () => {
    const i = XV.indexOf('export interface WriteScriptOptions');
    const block = XV.slice(i, XV.indexOf('}', XV.indexOf('onHeartbeat', i)));
    expect(block).toMatch(/language\?:\s*TargetLanguage/);
  });

  it('**Pass 1 的身份不再写死「中文编剧」** —— 角色设定本身就在带偏模型', () => {
    expect(XV, '仍写死中文编剧').not.toMatch(/精通分镜的中文编剧/);
    const i = XV.indexOf('const planningPrompt');
    expect(XV.slice(i, i + 200)).toContain('langMeta.nativeName');
  });

  it('Pass 2 的系统提示词挂上语种铁律,且**复用同一个 helper**(不另写一份)', () => {
    expect(XV).toContain('buildLanguageDirective(lang)');
    expect(XV).toMatch(/from '@\/lib\/language-detect'/);
  });

  it('缺省 zh —— 老项目行为一字不变', () => {
    expect(XV).toMatch(/opts\.language \|\| 'zh'/);
  });

  it('**三个调用点全部传了**(漏一个就有一条路继续出中文)', () => {
    const calls = (WRITER.match(/xverseService\.writeScript\(\{/g) || []).length;
    expect(calls, '调用点数量变了,请同步检查').toBe(3);
    const passed = (WRITER.match(/language: ctx\.targetLanguage\(\)/g) || []).length;
    expect(passed, `只有 ${passed} 处传了语种,应 ≥ ${calls}`).toBeGreaterThanOrEqual(calls);
  });
});

describe('v12.322 · 上游:导演也要知道语种(否则编剧在翻译而不是创作)', () => {
  it('自家 LLM 导演挂了语种铁律', () => {
    const i = ORCH.indexOf('const directorSystemPrompt = getDirectorSystemPrompt');
    const block = ORCH.slice(i, i + 400);
    expect(block).toContain('buildLanguageDirective(this.targetLanguage())');
  });

  it('XVerse 导演也挂了,且可由调用方指定', () => {
    const i = XV.indexOf('async runDirector');
    const block = XV.slice(i, i + 700);
    expect(block).toMatch(/language\?:\s*TargetLanguage/);
    expect(block).toContain("buildLanguageDirective(options.language || 'zh')");
  });
});

describe('v12.322 · 语种指令本身的口径(不能顺手改坏既有约定)', () => {
  it('**visualPrompt 仍留英文** —— 它喂视频引擎,混中文会被渲染成画面文字(v2.22 的坑)', () => {
    const en = buildLanguageDirective('en');
    const zh = buildLanguageDirective('zh');
    expect(en).toMatch(/visualPrompt/);
    expect(zh).toMatch(/visualPrompt/);
    expect(zh, '中文项目也要把 visualPrompt 留给英文').toMatch(/仍用英文|英文/);
  });

  it('非中文语种给出的是该语种的硬性要求,不是「尽量」', () => {
    const en = buildLanguageDirective('en');
    expect(en).toMatch(/MUST/);
    expect(en).toMatch(/Do NOT output Chinese/i);
  });
});

describe('v12.322 · 事后守门保留为兜底(不因为修了前置就删掉)', () => {
  it('v12.166 的语种守门仍在 —— 前置说清楚不等于模型一定照做', () => {
    expect(ORCH).toContain('needsLanguageFix');
    expect(ORCH).toContain('buildLanguageFixPrompt');
  });

  it('守门仍是「修不好就保留原稿」的诚实降级,没被改成静默丢弃', () => {
    // 锚在「修复稿结构不符」那条 warn 上,而不是数字符数 —— 固定窗口会切在 import 行
    // 后面 900 字符处,够不到真正的降级分支(这轮又栽了一次)。
    expect(ORCH, '修不好时应保留原稿并告警').toMatch(/LangGuard[^\n]*保留原稿/);
    expect(ORCH, '不得把失败改成静默丢弃').not.toMatch(/script = null/);
  });
});
