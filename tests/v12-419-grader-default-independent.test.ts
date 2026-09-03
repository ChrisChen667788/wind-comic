/**
 * v12.419 — 上一版报了一条不成立的告警,而这一版让它真正默认生效。
 *
 * ── 先修 v12.412 自己的 bug ────────────────────────────────────────────
 * v12.412 说「Vision Audit 和写分镜 prompt 的是同一个模型」,于是拿 grader 与
 * `API_CONFIG.openai.model` 比。**但被评的内容不是 `model` 写的** ——
 * 剧本/分镜/visualPrompt 由 `writer-agent` 调 `callLLM(..., useCreativeModel=true)`
 * 出,走的是 `creativeModel`。而 grader 用的就是 `model` 本身,
 * 所以那个判据**永远返回「自评中」**。
 *
 * 本机实测:`OPENAI_CREATIVE_MODEL=claude-fable-5`、`OPENAI_MODEL=claude-opus-5` ——
 * 本来就是两个模型。也就是说 v12.412 之后每跑一次审计都打印一句不成立的告警。
 *
 * **一条不成立的告警不是「稳妥」,它是噪音**:每次都响的告警,到真出问题那次也没人看。
 * 与 v12.418 那道误报的近重复检测、v12.400「会误报的门禁只会训练人忽略门禁」同一条教训 ——
 * 只不过这次误报的是我自己上一版加的东西。
 *
 * ── 再让它默认生效 ────────────────────────────────────────────────────
 * 通用档通常已异于作者,那本身就够独立。真正同模型时,此前只能报警然后照样自评;
 * 而仓库里**早就有**一条完全独立的路:`LLM_FALLBACK_*`(独立域名 + 独立 key + 不同模型)。
 * 评分是轻量只读的活儿,拿它当判官不需要新增任何配置。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveGraderConfig } from '@/lib/grader-config';
import { API_CONFIG } from '@/lib/config';
import fs from 'node:fs';

const KEYS = ['GRADER_MODEL', 'GRADER_BASE_URL', 'GRADER_API_KEY', 'OPENAI_MODEL', 'OPENAI_CREATIVE_MODEL', 'LLM_FALLBACK_MODEL', 'LLM_FALLBACK_API_KEY', 'LLM_FALLBACK_BASE_URL', 'OPENAI_API_KEY'];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

describe('v12.419 · 独立评分默认生效', () => {
  it('判独立性比的是**剧本作者**,不是 grader 自己', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_MODEL = 'judge-model';
    process.env.OPENAI_CREATIVE_MODEL = 'author-model';
    const g = resolveGraderConfig();
    expect(g.authorModel, '要把作者模型带出来,否则无从判断比的是谁').toBe('author-model');
    expect(g.independent, '作者与评分是两个模型 → 就是独立,不该报自评').toBe(true);
    expect(g.reason).toContain('剧本作者');
  });

  it('作者与通用档真是同一个模型时,自动改用现成的独立路径', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_MODEL = 'same-model';
    process.env.OPENAI_CREATIVE_MODEL = 'same-model';
    process.env.LLM_FALLBACK_MODEL = 'other-house-model';
    process.env.LLM_FALLBACK_API_KEY = 'fk';
    process.env.LLM_FALLBACK_BASE_URL = 'https://other-house.example/v1';

    const g = resolveGraderConfig();
    expect(g.model, '没自动切 = 报了警却照样自评').toBe('other-house-model');
    expect(g.independent).toBe(true);
    expect(g.autoPicked, '自动选了哪条路要说出来,不能悄悄换').toContain('LLM_FALLBACK');
    expect(g.reason).toContain('自动选用');
  });

  it('fallback 链没配齐时不硬凑 —— 老实报自评比假装独立好', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_MODEL = 'same-model';
    process.env.OPENAI_CREATIVE_MODEL = 'same-model';
    // 只有模型没有 key —— 拿它去调必然 401
    process.env.LLM_FALLBACK_MODEL = 'other-house-model';

    const g = resolveGraderConfig();
    expect(g.independent).toBe(false);
    expect(g.autoPicked).toBeUndefined();
    expect(g.reason).toContain('自评');
  });

  it('fallback 模型与作者相同也不算独立 —— 换个名字不等于换个判官', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_MODEL = 'same-model';
    process.env.OPENAI_CREATIVE_MODEL = 'same-model';
    process.env.LLM_FALLBACK_MODEL = 'same-model';
    process.env.LLM_FALLBACK_API_KEY = 'fk';
    expect(resolveGraderConfig().independent).toBe(false);
  });

  it('显式 GRADER_MODEL 优先于自动挑选', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_MODEL = 'same-model';
    process.env.OPENAI_CREATIVE_MODEL = 'same-model';
    process.env.LLM_FALLBACK_MODEL = 'auto-pick';
    process.env.LLM_FALLBACK_API_KEY = 'fk';
    process.env.GRADER_MODEL = 'my-explicit-judge';

    const g = resolveGraderConfig();
    expect(g.model).toBe('my-explicit-judge');
    expect(g.autoPicked, '人显式配了就别再自动挑').toBeUndefined();
  });

  it('显式把 GRADER_MODEL 设成作者模型,仍然不算独立(要防的自欺)', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_CREATIVE_MODEL = 'author-model';
    process.env.GRADER_MODEL = 'author-model';
    expect(resolveGraderConfig().independent, '配个同名就宣称独立 = 假绿').toBe(false);
  });

  it('vision-audit 用的是这份配置,且非独立时仍会告警', () => {
    const src = fs.readFileSync('lib/vision-audit.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src, '窗口自证').toContain('buildAuditPrompt');
    expect(src).toContain('resolveGraderConfig()');
    expect(src.includes('model: API_CONFIG.openai.model'), '又退回用通用档直接打分').toBe(false);
    const i = src.indexOf('resolveGraderConfig()');
    expect(src.slice(i, i + 400)).toMatch(/console\.warn\(/);
  });
});
