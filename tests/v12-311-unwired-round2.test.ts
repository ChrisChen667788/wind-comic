/**
 * v12.311 — 补跑审计的后半:三条「能力造好但没接线」(第 15 项收官)。
 *
 * ① **成本归因面板对所有用户永远空。** `lib/cost-attribution` 的
 *    `costEventsFromCostLog` / `attributeCost` 一直存在且可用,但
 *    `GET /api/projects/[id]/cost` **从没调过它们** —— 前端 `CostAttributionPanel`
 *    读的 `body.attribution` 恒为 undefined,面板永远显示「暂无成本数据」,
 *    类目条形 / 省钱提示 / 预算护栏三块功能整体失效。
 *
 * ② ③ **两处硬编码 `language: 'zh-CN'`。** 项目经 `/localize` 翻成日/英/韩之后:
 *    - 点「合成配音」(`POST /api/projects/[id]/shot-audio`)
 *    - 点「重录」(`lib/voice-retake.synthesizeRetake`)
 *    台词仍以**中文语种模式**发给 TTS,输出语音与文本语种不符。
 *    而 `lib/language-detect` 的 `detectLanguage` + `ttsLangCode` 早就有,
 *    `lib/narration-synth.ts:129` 在 **v12.6.1 就已经按这个口径修过** ——
 *    这两条路径当时漏了,一漏就是几十个版本。
 *
 * 三条同属本仓最顽固的那个病:**东西造好了,主路径没接**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { attributeCost, costEventsFromCostLog } from '@/lib/cost-attribution';
import { detectLanguage, ttsLangCode } from '@/lib/language-detect';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const COST = strip(fs.readFileSync('app/api/projects/[id]/cost/route.ts', 'utf-8'));
const SHOT = strip(fs.readFileSync('app/api/projects/[id]/shot-audio/route.ts', 'utf-8'));
const RETAKE = strip(fs.readFileSync('lib/voice-retake.ts', 'utf-8'));
const PANEL = fs.readFileSync('components/project/cost-attribution-panel.tsx', 'utf-8');
/** 病因说明本身写在注释里 —— 断言它就必须读**原文**,不能用剥过注释的版本(刚栽了一次) */
const RAW = (f: string) => fs.readFileSync(f, 'utf-8');

describe('v12.311 · ① 成本归因终于接上了', () => {
  it('API 响应里真的带 attribution 字段', () => {
    expect(COST).toContain('attributeCost(costEventsFromCostLog(rows))');
    const i = COST.lastIndexOf('NextResponse.json({ projectId: id');
    expect(COST.slice(i, i + 200), '要真的放进响应体').toContain('attribution');
  });

  it('前端读的字段名与后端给的**一致**(病根就在这一个字上)', () => {
    expect(PANEL).toContain('body.attribution');
    expect(COST).toMatch(/attribution\b/);
  });

  it('归因能力本身是好的 —— 之前只是没人调', () => {
    const attr = attributeCost(costEventsFromCostLog([
      { engine: 'veo', costCny: 12 },
      { engine: 'minimax', costCny: 8 },
    ]));
    expect(attr.totalCny).toBeGreaterThan(0);
  });

  it('零成本项目不炸(新项目打开面板也不该报错)', () => {
    expect(() => attributeCost(costEventsFromCostLog([]))).not.toThrow();
    expect(attributeCost(costEventsFromCostLog([])).totalCny).toBe(0);
  });

  it('CSV 导出与 COGS 报告两条老分支没被改动', () => {
    expect(COST).toContain("searchParams.get('export') === 'csv'");
    expect(COST).toContain("sp.get('report') === 'cogs'");
  });
});

describe('v12.311 · ②③ 本地化项目不再被强行按中文发音', () => {
  it('**两处硬编码 zh-CN 必须消失**', () => {
    expect(SHOT, 'shot-audio 仍硬编码').not.toMatch(/language: 'zh-CN'/);
    expect(RETAKE, 'voice-retake 仍硬编码').not.toMatch(/language: 'zh-CN'/);
  });

  it('改为按台词自检语种,且与 narration-synth 同一口径', () => {
    expect(SHOT).toContain('ttsLangCode(detectLanguage(');
    expect(RETAKE).toContain('ttsLangCode(detectLanguage(');
    const ref = fs.readFileSync('lib/narration-synth.ts', 'utf-8');
    expect(ref, '参考实现口径').toContain('ttsLangCode(detectLanguage(text))');
  });

  it('检测器行为:中/日/英各自给出不同语种码', () => {
    const zh = ttsLangCode(detectLanguage('今天的月色真美'));
    const en = ttsLangCode(detectLanguage('The moon is beautiful tonight'));
    expect(zh).toMatch(/^zh/);
    expect(en).not.toBe(zh);
  });

  it('空文本/异常输入不炸(重录空台词不该把整条路径打挂)', () => {
    for (const t of ['', '   ', null, undefined] as any[]) {
      expect(() => ttsLangCode(detectLanguage(t))).not.toThrow();
    }
  });

  it('两处都传了 speed/pitch(改语种时别把韵律参数弄丢)', () => {
    for (const [name, src] of [['shot-audio', SHOT], ['voice-retake', RETAKE]] as const) {
      const i = src.indexOf('dispatchTTSGenerate({');
      const block = src.slice(i, i + 300);
      expect(block, `${name} 丢了 speed`).toContain('speed: prosody.speed');
      expect(block, `${name} 丢了 pitch`).toContain('pitch: prosody.pitch');
    }
  });
});

describe('v12.311 · 病根记录(防后人再把这三处当成「没做的功能」)', () => {
  it('三处都留了说明,指明是「造好没接线」而非未实现', () => {
    expect(RAW('app/api/projects/[id]/cost/route.ts')).toMatch(/v12\.311/);
    expect(RAW('app/api/projects/[id]/shot-audio/route.ts')).toMatch(/v12\.311/);
    expect(RAW('lib/voice-retake.ts')).toMatch(/v12\.311/);
  });

  it('语种那两处点明了参考口径(narration-synth 早在 v12.6.1 就修过)', () => {
    const both = RAW('app/api/projects/[id]/shot-audio/route.ts') + RAW('lib/voice-retake.ts');
    expect(both).toMatch(/narration-synth|v12\.6\.1|同一口径|同上/);
  });
});
