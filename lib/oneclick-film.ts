/**
 * lib/oneclick-film (v9.4.3) — 一键成片闭环编排规划。
 *
 * 对标可灵 3.0「一键成片 / Multi-Shot Director」(脚本 → 智能分镜 → 多镜成片)。
 * 我们的差异化 = **闭环自愈**:多参元素(`reference-elements`)→ 全流水线 → 质量门禁(`quality-gate`)→
 * 自动重拍弱镜(`rebirth-plan`)→ 达标才出片。可灵是**开环**(生成即结束,好坏一把过),我们是**闭环**。
 *
 * 纯逻辑:① `planOneClickFilm` 把 idea + 元素 → 成片计划(参考绑定 + 自愈策略);
 *        ② `decideIteration` 每轮生成+质检后裁决「完成 / 自动重拍 / 交人工」。
 * 复用三块引擎拼成闭环,供 orchestrator 执行。单测 tests/v9-4-4-oneclick-film.test.ts。
 */
import { bindElements, elementCompleteness, type ReferenceElement, type ElementBinding } from './reference-elements';
import { buildRebirthPlan, type AuditedShotLike, type RebirthShot } from './rebirth-plan';
import { evaluateQualityGate, type FilmAuditLike, type QualityDimsLike, type QualityGateResult } from './quality-gate';

export interface OneClickConfig {
  idea: string;
  elements?: ReferenceElement[];
  /** 弱镜重拍阈值(默认 75 = Vision pass 线) */
  rebirthThreshold?: number;
  /** 最多自愈轮数(默认 2) */
  maxRebirthRounds?: number;
}

export interface OneClickPlan {
  idea: string;
  /** 多参元素 → 路由进 cref/sref/DNA 的绑定计划 */
  binding: ElementBinding;
  /** 元素完整度 0-100(角色/风格/场景加权) */
  completenessScore: number;
  rebirthThreshold: number;
  maxRebirthRounds: number;
  /** idea 非空 → 可成片 */
  ready: boolean;
  /** 中文计划说明(参考状态 + 自愈策略) */
  notes: string[];
}

/**
 * idea + 元素 → 一键成片计划:绑定多参、评估元素完整度、定自愈策略(阈值 + 轮数)。
 */
export function planOneClickFilm(cfg: OneClickConfig): OneClickPlan {
  const idea = (cfg.idea || '').trim();
  const elements = cfg.elements || [];
  const binding = bindElements(elements);
  const completeness = elementCompleteness(elements);
  const rebirthThreshold = cfg.rebirthThreshold ?? 75;
  const maxRebirthRounds = Math.max(0, cfg.maxRebirthRounds ?? 2);

  const notes: string[] = [];
  if (!idea) notes.push('请先填一句创意(idea)');
  if (binding.routed === 0) notes.push('未挂参考元素 —— 将走纯文本成片(可加角色/风格/场景参考提升一致性)');
  else {
    const parts: string[] = [];
    if (binding.crefImages.length) parts.push(`角色×${binding.crefImages.length}→cref+DNA`);
    if (binding.srefImages.length) parts.push(`风格×${binding.srefImages.length}→sref`);
    if (binding.sceneImages.length) parts.push(`场景×${binding.sceneImages.length}`);
    if (binding.voiceAudios.length) parts.push(`音色×${binding.voiceAudios.length}→TTS`);
    notes.push(`多参已绑定:${parts.join(' · ')}`);
  }
  notes.push(`闭环自愈:每镜 < ${rebirthThreshold} 分自动重拍,最多 ${maxRebirthRounds} 轮,门禁达标才出片`);

  return {
    idea,
    binding,
    completenessScore: completeness.score,
    rebirthThreshold,
    maxRebirthRounds,
    ready: idea.length > 0,
    notes,
  };
}

export interface IterationInput {
  /** 当前轮次(1 起) */
  round: number;
  /** 本轮每镜质检结果 */
  audits?: AuditedShotLike[];
  /** 成片 Vision 聚合(门禁用) */
  filmAudit?: FilmAuditLike | null;
  /** 成片 3 维评分(门禁用) */
  qualityScore?: QualityDimsLike | null;
}

export type OneClickDecision = 'done' | 'rebirth' | 'blocked';

export interface IterationVerdict {
  decision: OneClickDecision;
  gate: QualityGateResult;
  /** decision=rebirth 时:本轮要自动重拍的弱镜(优先级 + focusHint) */
  rebirthShots: RebirthShot[];
  round: number;
  message: string;
}

/**
 * 闭环每轮裁决(跑完一轮生成 + 质检后):
 *   - 门禁 ready(pass/warn)→ **done**(达标出片;warn 可接受,避免过度打磨)
 *   - 门禁 block + 还有轮数 + 有弱镜可修 → **rebirth**(自动重拍弱镜,进下一轮)
 *   - 门禁 block 但已到最大轮数 / 无弱镜可修 → **blocked**(交人工)
 */
export function decideIteration(plan: OneClickPlan, input: IterationInput): IterationVerdict {
  const round = Math.max(1, input.round || 1);
  const gate = evaluateQualityGate({ filmAudit: input.filmAudit ?? null, qualityScore: input.qualityScore ?? null });
  const rebirth = buildRebirthPlan(input.audits || [], { threshold: plan.rebirthThreshold });

  if (gate.ready) {
    return { decision: 'done', gate, rebirthShots: [], round, message: `第 ${round} 轮达标 — ${gate.message}` };
  }
  // gate block
  const canRebirth = round < plan.maxRebirthRounds + 1 && rebirth.count > 0;
  if (canRebirth) {
    return {
      decision: 'rebirth',
      gate,
      rebirthShots: rebirth.shots,
      round,
      message: `第 ${round} 轮未达标(${gate.message})— 自动重拍 ${rebirth.count} 个弱镜后进下一轮`,
    };
  }
  return {
    decision: 'blocked',
    gate,
    rebirthShots: rebirth.shots,
    round,
    message: rebirth.count === 0
      ? `未达标但无可自动修复的弱镜(${gate.message})— 建议人工介入`
      : `已自愈 ${plan.maxRebirthRounds} 轮仍未达标(${gate.message})— 建议人工介入`,
  };
}
