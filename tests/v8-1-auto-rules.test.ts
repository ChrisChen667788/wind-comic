/**
 * v8.1 — lib/auto-rules 单测 (智能联动规则引擎)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RULES, buildRuleContext, evaluateCondition, evaluateRules, applyRulesToSpec,
  type RuleContext, type AutoRule,
} from '@/lib/auto-rules';
import { DEFAULT_SHOT_SPEC, normalizeShotSpec } from '@/lib/cinematography';

const ctxHi: RuleContext = { tension: 85, intensity: 88, shotSize: 'CU', atmosphere: 'neon' };
const ctxLo: RuleContext = { tension: 15, intensity: 30, shotSize: 'WS', atmosphere: 'clear' };

describe('预设规则', () => {
  it('非空 + id 唯一 + 结构完整', () => {
    expect(DEFAULT_RULES.length).toBeGreaterThanOrEqual(5);
    const ids = DEFAULT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_RULES.every((r) => r.label && r.when.length > 0 && r.then)).toBe(true);
  });
});

describe('evaluateCondition', () => {
  it('gte / lte 数值', () => {
    expect(evaluateCondition(ctxHi, { metric: 'tension', op: 'gte', value: 70 })).toBe(true);
    expect(evaluateCondition(ctxLo, { metric: 'tension', op: 'gte', value: 70 })).toBe(false);
    expect(evaluateCondition(ctxLo, { metric: 'tension', op: 'lte', value: 25 })).toBe(true);
  });
  it('in 枚举 (shotSize / atmosphere)', () => {
    expect(evaluateCondition(ctxHi, { metric: 'shotSize', op: 'in', values: ['CU', 'ECU'] })).toBe(true);
    expect(evaluateCondition(ctxLo, { metric: 'shotSize', op: 'in', values: ['CU', 'ECU'] })).toBe(false);
    expect(evaluateCondition(ctxHi, { metric: 'atmosphere', op: 'in', values: ['neon', 'night'] })).toBe(true);
  });
  it('缺 value/values → false (不误触发)', () => {
    expect(evaluateCondition(ctxHi, { metric: 'tension', op: 'gte' })).toBe(false);
    expect(evaluateCondition(ctxHi, { metric: 'shotSize', op: 'in' })).toBe(false);
  });
});

describe('buildRuleContext', () => {
  it('情绪词 → tension/intensity; spec → shotSize/atmosphere', () => {
    const ctx = buildRuleContext({ emotion: '愤怒', spec: normalizeShotSpec({ shotSize: 'CU', atmosphere: 'rain' }) });
    expect(ctx.tension).toBeGreaterThan(80);
    expect(ctx.shotSize).toBe('CU');
    expect(ctx.atmosphere).toBe('rain');
  });
  it('无情绪 → 中性', () => {
    const ctx = buildRuleContext({ emotion: '', spec: DEFAULT_SHOT_SPEC });
    expect(ctx.intensity).toBe(40);
  });
});

describe('evaluateRules', () => {
  it('高紧张+特写+霓虹 → 多规则命中 + 补丁合并', () => {
    const { fired, patch } = evaluateRules(ctxHi);
    const ids = fired.map((r) => r.id);
    expect(ids).toContain('tense-lowkey');
    expect(ids).toContain('cu-shallow');
    expect(ids).toContain('intense-motion');
    expect(ids).toContain('neon-cool');
    // neon-cool 后于 tense-lowkey, lighting.setup 被覆盖为 neon-noir; contrast 仍来自 tense-lowkey
    expect(patch.lighting?.setup).toBe('neon-noir');
    expect(patch.lighting?.contrast).toBe('high');
    expect(patch.focus).toBe('shallow');
    expect(patch.motion).toBe(70);
    expect(patch.camera?.tStop).toBe(1.4);
  });
  it('平静 → 高调低反差', () => {
    const { fired, patch } = evaluateRules(ctxLo);
    expect(fired.map((r) => r.id)).toContain('calm-highkey');
    expect(patch.lighting?.setup).toBe('high-key');
    expect(patch.lighting?.contrast).toBe('low');
  });
  it('enabled:false 不触发', () => {
    const rules: AutoRule[] = [{ id: 'x', label: 'x', enabled: false, when: [{ metric: 'tension', op: 'gte', value: 0 }], then: { motion: 99 } }];
    expect(evaluateRules(ctxHi, rules).fired).toHaveLength(0);
  });
});

describe('applyRulesToSpec', () => {
  it('应用补丁 → 新 spec (normalize) + 命中清单', () => {
    const base = normalizeShotSpec({ shotSize: 'CU', atmosphere: 'neon', lighting: { setup: 'natural', keyTempK: 5600, contrast: 'medium' }, motion: 30 });
    const ctx = buildRuleContext({ emotion: '震惊', spec: base });
    const out = applyRulesToSpec(base, ctx);
    expect(out.spec.lighting.setup).toBe('neon-noir');
    expect(out.spec.focus).toBe('shallow');
    expect(out.spec.motion).toBe(70);
    expect(out.spec.camera.tStop).toBe(1.4);
    expect(out.firedIds.length).toBeGreaterThan(0);
    expect(out.firedLabels.join()).toContain('特写');
  });
  it('无命中 → spec 基本不变', () => {
    const base = normalizeShotSpec({ shotSize: 'MS', atmosphere: 'clear' });
    const ctx: RuleContext = { tension: 40, intensity: 50, shotSize: 'MS', atmosphere: 'clear' };
    const out = applyRulesToSpec(base, ctx);
    expect(out.firedIds).toHaveLength(0);
    expect(out.spec.shotSize).toBe('MS');
  });
});
