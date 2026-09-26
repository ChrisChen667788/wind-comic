/**
 * lib/pacing-gate.ts(v12.455)—— 节奏审计的**真拦截**。
 *
 * 病象:节奏审计从 v2.21 起就有,但一直只提示不拦(writer-agent 注释原话「非阻塞」);
 * README 和 docs/COMPETITIVE-GAP-2026-09.md 却把它写成「可拦截的独立工程门禁」——
 * 文档与代码打架,而且是在一份以「可证伪」为卖点的竞品台账里。这里把拦截补成真的。
 *
 * 三档(PACING_GATE / 请求字段 pacingGate):
 *   off   —— 不审(只保留编剧阶段原有的提示)
 *   warn  —— 默认。审,不达标只提示,流水线照走(v2.21 起的原行为:让人先看到画面再决定)
 *   block —— 审,不达标就在角色设计之前停下;后面的出图、视频都不开始
 *
 * 取舍(每条都是踩过的坑):
 *  - **不复用 waitForGate**:那套人工闸门 5 分钟没人响应就自动放行。拿它当门禁,
 *    用户走开 5 分钟,不达标的剧本照样开拍 —— 等于没拦。这里是硬停,只有两条路能继续:
 *    改剧本后续跑(会按新剧本重审)、或显式放行(pacingOverride,会留痕)。
 *  - **不信任 script.pacingReport**:剧本可能在人工闸门被改过、续跑装载的也可能是旧报告。
 *    一律按当前剧本重算(纯函数,零成本);dramaMode 沿用编剧阶段那份报告的口径,保证与界面显示一致。
 *  - **审计抛错时 block 按拦下算**(fail-closed):否则审计一坏,门禁就全部放行 —— 这正是假门禁。
 *  - **请求只能收紧、不能放松**:运维设了 PACING_GATE=block,请求里带 pacingGate:'off' 不能绕过。
 *  - 拉片复刻不拦:剧本结构来自原片,不是编剧产出。
 *  - **非中文剧本不拦**:冲突词典只有中文,英/日/韩剧本冲突分恒为 0,block 档会把它们全部误拦。
 *    跳过时给出原因,调用方在 block 档下要把「这次没生效」告诉用户。
 */

import { auditScript, type PacingAuditReport } from '@/lib/pacing-audit';
import { isDramaContext } from '@/lib/drama-tropes';
import { createError } from '@/lib/pipeline-error';

export type PacingGateMode = 'off' | 'warn' | 'block';
export const PACING_GATE_MODES: readonly PacingGateMode[] = ['off', 'warn', 'block'];
const STRICTNESS: Record<PacingGateMode, number> = { off: 0, warn: 1, block: 2 };

function parseMode(v: unknown): PacingGateMode | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (PACING_GATE_MODES as readonly string[]).includes(s) ? (s as PacingGateMode) : null;
}

/**
 * 实际生效的档位:运维配置(env)是下限,请求只能往更严的方向调。
 * env 未设或写错 → warn(原行为);请求字段写错 → 忽略。
 */
export function resolvePacingGateMode(requested?: unknown, env: NodeJS.ProcessEnv = process.env): PacingGateMode {
  const base = parseMode(env.PACING_GATE) ?? 'warn';
  const req = parseMode(requested);
  if (!req) return base;
  return STRICTNESS[req] > STRICTNESS[base] ? req : base;
}

export type PacingGateVerdict = 'skip' | 'pass' | 'warn' | 'block' | 'override';

export interface PacingGateDecision {
  mode: PacingGateMode;
  verdict: PacingGateVerdict;
  /** 按当前剧本重算的报告;off / 拉片复刻 / 审计抛错时为 null */
  report: PacingAuditReport | null;
  /** 给人看的原因(不达标项,或跳过/失败的说明) */
  reasons: string[];
}

export interface PacingGateInput {
  script: unknown;
  mode: PacingGateMode;
  /** 短剧口径更严;调用方传编剧阶段报告里的 dramaMode,没有再自己判 */
  dramaMode: boolean;
  /** 拉片复刻:剧本结构来自原片 */
  replica?: boolean;
  /** 用户明确确认「节奏不达标也照拍」 */
  override?: boolean;
}

/**
 * 冲突词典(lib/pacing-audit.ts)只有中文:英文/日文/韩文剧本的冲突分会恒为 0,
 * block 档下等于「非中文剧本一律拦」。所以只在中文占主导时才审。
 * 只看审计实际读的字段(action/dialogue/emotion),与 auditScript 口径一致。
 * 不用 lib/language-detect:它把假名、谚文也算作中文。
 * 拉丁文按**词**计、每词折半个汉字(汉字 × 2 ≥ 英文词数),两头都踩过坑:
 *  - 按字母数(旧:汉字 × 4 ≥ 字母):一个英文名(Alexander Thompson = 17 个字母)只相当于一两个汉字,
 *    人名一多,中文剧本就被判成「非中文」而跳过门禁;
 *  - 按词数 1:1(汉字 ≥ 词数):AI / VR / CU / SFX 这类短缩写、分镜术语每个都算一个整字,
 *    科技题材或用英文分镜格式的中文剧本又被误判(v12.455 复查挖出)。
 *  真英文剧本满是 the/and/to 这类虚词,词数远多于偶尔夹带的汉字,折半后仍判为非中文。
 * 没有任何文字(空剧本)→ 按中文处理:空剧本本来就该被拦。
 */
export function isChineseScriptText(script: unknown): boolean {
  const shots = (script as { shots?: unknown })?.shots;
  if (!Array.isArray(shots)) return true;
  const text = shots
    .map((s) => { const x = (s ?? {}) as Record<string, unknown>; return `${x.action ?? ''} ${x.dialogue ?? ''} ${x.emotion ?? ''}`; })
    .join(' ');
  const han = (text.match(/[一-鿿]/g) || []).length;
  const kanaHangul = (text.match(/[぀-ヿ가-힯]/g) || []).length;
  const latinWords = (text.match(/[a-zA-Z]+/g) || []).length;
  if (han === 0 && kanaHangul === 0 && latinWords === 0) return true;
  return han > 0 && han >= 2 * kanaHangul && han * 2 >= latinWords;
}

export function decidePacingGate(input: PacingGateInput): PacingGateDecision {
  const { mode } = input;
  if (mode === 'off') return { mode, verdict: 'skip', report: null, reasons: [] };
  if (input.replica) {
    return { mode, verdict: 'skip', report: null, reasons: ['拉片复刻按原片结构起片,不做节奏拦截'] };
  }
  if (!isChineseScriptText(input.script)) {
    return { mode, verdict: 'skip', report: null, reasons: ['节奏审计的冲突词典目前只覆盖中文,这份剧本不是中文,不做拦截'] };
  }

  let report: PacingAuditReport | null = null;
  let failure = '';
  try {
    const s = input.script as { shots?: unknown } | null | undefined;
    if (!s || !Array.isArray(s.shots)) throw new Error('剧本里没有分镜列表');
    report = auditScript(s as Parameters<typeof auditScript>[0], { dramaMode: input.dramaMode });
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  if (!report) {
    const reasons = [`节奏审计没能跑出结果(${failure.slice(0, 80)})`];
    if (mode === 'block') return { mode, verdict: input.override ? 'override' : 'block', report: null, reasons };
    return { mode, verdict: 'warn', report: null, reasons };
  }
  if (report.passed) return { mode, verdict: 'pass', report, reasons: [] };

  const reasons = report.warnings.length > 0 ? [...report.warnings] : ['节奏审计未达标'];
  if (mode === 'warn') return { mode, verdict: 'warn', report, reasons };
  return { mode, verdict: input.override ? 'override' : 'block', report, reasons };
}

/** 拦下时给用户看的话:停在哪、为什么、怎么继续。 */
export function pacingGateBlockMessage(d: Pick<PacingGateDecision, 'reasons'>): string {
  const why = d.reasons.slice(0, 3).join(';') || '节奏审计未达标';
  const more = d.reasons.length > 3 ? `(共 ${d.reasons.length} 条,详见节奏分析)` : '';
  return `剧本节奏审计未通过,已在角色设计之前停下,后面的出图和视频都没有开始。原因:${why}${more}。`
    + '改写剧本后续跑会按新剧本重新审计;如果确认要按现在的剧本拍,可以带上 pacingOverride 重新发起。';
}

/**
 * 两条创作入口(lib/create-pipeline.ts 与 HybridOrchestrator.startProduction)共用的一站式判定:
 * 档位收口 + dramaMode 取编剧阶段那份报告的口径(没有再按题材/创意判),保证同一剧本两处结论一致。
 */
export function gateScriptForProduction(
  script: unknown,
  ctx: { requestedMode?: unknown; genre?: string; idea?: string; replica?: boolean; override?: boolean; env?: NodeJS.ProcessEnv } = {},
): PacingGateDecision {
  const prior = (script as { pacingReport?: { dramaMode?: unknown } } | null | undefined)?.pacingReport;
  return decidePacingGate({
    script,
    mode: resolvePacingGateMode(ctx.requestedMode, ctx.env),
    dramaMode: typeof prior?.dramaMode === 'boolean' ? prior.dramaMode : isDramaContext(ctx.genre, ctx.idea),
    replica: ctx.replica,
    override: ctx.override,
  });
}

/** 没有请求级参数的入口(startProduction)用:只认服务端 PACING_GATE,拦下就抛,后面一步都不走。 */
export function assertPacingGate(script: unknown, genre?: string, idea?: string): void {
  const gate = gateScriptForProduction(script, { genre, idea });
  if (gate.verdict === 'block') {
    throw createError('PACING_GATE_BLOCKED', pacingGateBlockMessage(gate), {
      stage: 'script', retryable: false, details: { reasons: gate.reasons },
    });
  }
}
