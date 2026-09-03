/**
 * v12.412 — 同一个模型既生成又打分。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * `lib/vision-audit.ts` 用 `API_CONFIG.openai.*` 调视觉打分 ——
 * 和写分镜 prompt 的是同一个模型、同一套配置。它在给自己的产出打分。
 *
 * 提示词那一层是干净的(`buildAuditPrompt` 只喂剧本要求 + 画面,不含生成 prompt),
 * 所以没有措辞层面的暗示泄漏。但**模型层面的自我合理化**仍在:
 * 同一个模型对「我理解的『雨夜街头』」有一致先验,更容易认为自己画对了。
 *
 * ── 这条测试锁的是那条克制,而不是那个开关 ────────────────────────────
 * 加个 GRADER_MODEL 很容易;难的是**不许在没真正独立时宣称有独立 grader**。
 * 所以 `independent` 必须是**算出来的**(模型/端点/凭据确实不同才为 true),
 * 而不是一个配置项。配了个开关就宣称「已用独立评分」,正是这个项目一直在消灭的假绿。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveGraderConfig } from '@/lib/grader-config';
import { API_CONFIG } from '@/lib/config';
import fs from 'node:fs';

const KEYS = ['GRADER_MODEL', 'GRADER_BASE_URL', 'GRADER_API_KEY'];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

describe('v12.412 · 独立评分上下文', () => {
  it('什么都不配时回落通用档模型', () => {
    for (const k of KEYS) delete process.env[k];
    const g = resolveGraderConfig();
    expect(g.model).toBe(API_CONFIG.openai.model);
  });

  it('v12.419 订正:判独立性要比**剧本作者**(creativeModel),不是通用档', () => {
    // v12.412 拿 grader 与 cfg.model 比 —— 而 grader 用的就是 cfg.model,
    // 所以它永远报「自评中」。可被评的内容是 writer-agent 用 creativeModel 写的,
    // 两者本机实测就是两个模型(claude-fable-5 vs claude-opus-5)。
    // 于是那一版之后,每跑一次审计都打印一句不成立的告警 ——
    // 每次都响的告警,到真出问题那次也没人看。
    for (const k of KEYS) delete process.env[k];
    const g = resolveGraderConfig();
    expect(g.authorModel, '必须把作者模型带出来,否则无从判断比的是谁').toBe(API_CONFIG.openai.creativeModel);
    if (API_CONFIG.openai.creativeModel !== API_CONFIG.openai.model) {
      expect(g.independent, '作者与评分本就是两个模型 → 独立,不该再报自评').toBe(true);
      expect(g.reason).toContain('剧本作者');
    }
  });

  it('换成另一个模型才算独立', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.GRADER_MODEL = 'some-other-judge-model';
    const g = resolveGraderConfig();
    expect(g.model).toBe('some-other-judge-model');
    expect(g.independent).toBe(true);
    expect(g.reason).toContain('独立评分');
  });

  it('把 GRADER_MODEL 设成与**剧本作者**同一个模型,不算独立 —— 这正是要防的自欺', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.GRADER_MODEL = API_CONFIG.openai.creativeModel;
    const g = resolveGraderConfig();
    expect(g.independent, '配了个与作者同名的模型就宣称独立 = 假绿').toBe(false);
    expect(g.reason).toContain('自评');
    expect(g.reason, '要告诉人怎么才能真正独立').toContain('GRADER_MODEL');
  });

  it('端点或凭据不同也算独立(同模型不同供应商仍是另一个判官)', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.GRADER_BASE_URL = 'https://another-provider.example/v1';
    expect(resolveGraderConfig().independent).toBe(true);

    delete process.env.GRADER_BASE_URL;
    process.env.GRADER_API_KEY = 'a-different-key';
    expect(resolveGraderConfig().independent).toBe(true);
  });

  it('vision-audit 真的用了它,而且非独立时会大声记日志', () => {
    const src = fs.readFileSync('lib/vision-audit.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src, '窗口自证:这不是视觉审计模块?').toContain('buildAuditPrompt');
    expect(src).toContain('resolveGraderConfig()');
    // 不能再直接拿主配置去打分
    expect(src.includes('model: API_CONFIG.openai.model'), '又退回用生成模型打分了').toBe(false);
    const i = src.indexOf('resolveGraderConfig()');
    const block = src.slice(i, i + 400);
    expect(block, '非独立时必须留下可被看见的痕迹').toMatch(/console\.warn\(/);
  });
});
