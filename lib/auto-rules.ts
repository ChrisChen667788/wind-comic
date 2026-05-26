/**
 * lib/auto-rules (v8.1) — 智能联动规则引擎 (对标 CineMatrix「Auto-Update Logic」)
 *
 * 声明式规则: 当某镜的情绪/景别/氛围满足条件 → 自动给它的 ShotSpec 打补丁
 * (改光影/景深/运动…)。规则可序列化 (未来可存/可编辑), 引擎纯函数可单测。
 *
 * 把 v7.2 ShotSpec + v7.4 光影 + v7.5 情感串起来:
 *   "高紧张 → 低调高反差"、"特写 → 浅景深移焦"、"强情感 → 提运动" …
 */

import { emotionScore } from './emotion-curve';
import {
  normalizeShotSpec,
  type ShotSpec, type ShotSize, type AtmosphereId, type FocusId,
  type LightingSpec, type CameraSimSpec,
} from './cinematography';

export type RuleMetric = 'tension' | 'intensity' | 'shotSize' | 'atmosphere';
export type RuleOp = 'gte' | 'lte' | 'in';

export interface RuleCondition {
  metric: RuleMetric;
  op: RuleOp;
  value?: number;     // gte/lte 用
  values?: string[];  // in 用
}

/** 可打到 ShotSpec 上的补丁 (浅合并, lighting/camera 深合并) */
export interface SpecPatch {
  shotSize?: ShotSize;
  focus?: FocusId;
  atmosphere?: AtmosphereId;
  motion?: number;
  lighting?: Partial<LightingSpec>;
  camera?: Partial<CameraSimSpec>;
}

export interface AutoRule {
  id: string;
  label: string;
  /** 全部条件 AND 命中才触发 */
  when: RuleCondition[];
  then: SpecPatch;
  enabled?: boolean;
}

export interface RuleContext {
  tension: number;    // 0-100
  intensity: number;  // 0-100
  shotSize: ShotSize;
  atmosphere: AtmosphereId;
}

export const DEFAULT_RULES: AutoRule[] = [
  { id: 'tense-lowkey',   label: '高紧张 → 低调 + 高反差',     when: [{ metric: 'tension', op: 'gte', value: 70 }], then: { lighting: { setup: 'low-key', contrast: 'high' } } },
  { id: 'cu-shallow',     label: '特写 → 浅景深 + 大光圈移焦', when: [{ metric: 'shotSize', op: 'in', values: ['CU', 'ECU'] }], then: { focus: 'shallow', camera: { tStop: 1.4 } } },
  { id: 'intense-motion', label: '强情感 → 提升运动强度',       when: [{ metric: 'intensity', op: 'gte', value: 80 }], then: { motion: 70 } },
  { id: 'calm-highkey',   label: '平静 → 柔和高调 + 低反差',   when: [{ metric: 'tension', op: 'lte', value: 25 }], then: { lighting: { setup: 'high-key', contrast: 'low' } } },
  { id: 'neon-cool',      label: '霓虹/夜 → 霓虹黑色 + 冷色温', when: [{ metric: 'atmosphere', op: 'in', values: ['neon', 'night'] }], then: { lighting: { setup: 'neon-noir', keyTempK: 6500 } } },
];

/** 由"情绪词 + 当前 spec"构造规则上下文 */
export function buildRuleContext(opts: { emotion?: string; spec: ShotSpec }): RuleContext {
  const s = normalizeShotSpec(opts.spec);
  const e = emotionScore(opts.emotion);
  return { tension: e.tension, intensity: e.intensity, shotSize: s.shotSize, atmosphere: s.atmosphere };
}

export function evaluateCondition(ctx: RuleContext, c: RuleCondition): boolean {
  if (c.metric === 'tension' || c.metric === 'intensity') {
    const v = ctx[c.metric];
    if (c.op === 'gte') return typeof c.value === 'number' && v >= c.value;
    if (c.op === 'lte') return typeof c.value === 'number' && v <= c.value;
    return false;
  }
  // shotSize / atmosphere → in
  const target = ctx[c.metric];
  if (c.op === 'in') return Array.isArray(c.values) && c.values.includes(target);
  return false;
}

function ruleMatches(ctx: RuleContext, rule: AutoRule): boolean {
  if (rule.enabled === false) return false;
  return rule.when.length > 0 && rule.when.every((c) => evaluateCondition(ctx, c));
}

/** 评估所有规则 → 命中的规则 + 合并后的补丁 (后命中的覆盖先命中的) */
export function evaluateRules(ctx: RuleContext, rules: AutoRule[] = DEFAULT_RULES): { fired: AutoRule[]; patch: SpecPatch } {
  const fired = rules.filter((r) => ruleMatches(ctx, r));
  const patch: SpecPatch = {};
  for (const r of fired) {
    const p = r.then;
    if (p.shotSize) patch.shotSize = p.shotSize;
    if (p.focus) patch.focus = p.focus;
    if (p.atmosphere) patch.atmosphere = p.atmosphere;
    if (typeof p.motion === 'number') patch.motion = p.motion;
    if (p.lighting) patch.lighting = { ...patch.lighting, ...p.lighting };
    if (p.camera) patch.camera = { ...patch.camera, ...p.camera };
  }
  return { fired, patch };
}

/** 把规则补丁应用到 spec, 返回新 spec (已 normalize) + 命中规则 */
export function applyRulesToSpec(
  spec: ShotSpec,
  ctx: RuleContext,
  rules: AutoRule[] = DEFAULT_RULES,
): { spec: ShotSpec; firedIds: string[]; firedLabels: string[] } {
  const base = normalizeShotSpec(spec);
  const { fired, patch } = evaluateRules(ctx, rules);
  const merged: ShotSpec = normalizeShotSpec({
    ...base,
    ...(patch.shotSize ? { shotSize: patch.shotSize } : {}),
    ...(patch.focus ? { focus: patch.focus } : {}),
    ...(patch.atmosphere ? { atmosphere: patch.atmosphere } : {}),
    ...(typeof patch.motion === 'number' ? { motion: patch.motion } : {}),
    lighting: { ...base.lighting, ...(patch.lighting || {}) },
    camera: { ...base.camera, ...(patch.camera || {}) },
  });
  return { spec: merged, firedIds: fired.map((r) => r.id), firedLabels: fired.map((r) => r.label) };
}
