/**
 * v6.1.3 — 生成前就绪度评估 (Prompt Readiness) · 纯逻辑 (无依赖, 可单测)
 *
 * 在按"开始创作"前给一个确定性的"就绪度"分 + 检查清单, 让用户先补齐再花生成成本.
 * 复用既有信号: cameo-vision 的主角脸试穿评分 (cameoScore 传入) + 风格统一概念
 * (style 资产是否被引用, 呼应 style-audit). 本函数只吃基本量, 便于测试 & client 复用.
 */

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  weight: number;
  /** 未达成时的改进提示 */
  hint?: string;
}

export interface ReadinessReport {
  /** 0-100 加权得分 */
  score: number;
  level: 'low' | 'mid' | 'high';
  checks: ReadinessCheck[];
  compiledLength: number;
}

export interface ReadinessInput {
  /** compilePrompt 后的实际 prompt */
  compiledPrompt: string;
  /** 被引用资产的 kind 列表 (compilePrompt used[].kind) */
  usedKinds: string[];
  /** 未匹配引用数 (compilePrompt unresolved.length) */
  unresolvedCount: number;
  /** 是否上传了主角脸 (cameo) */
  hasFace: boolean;
  /** 各类多模态参考数量 */
  refs: { image: number; audio: number; video: number };
  /** 复用 cameo-vision scoreCameoImage 的总分 (有脸时才有意义) */
  cameoScore?: number | null;
}

/** cameo 试穿评分及格线 (与 v2.11 Cameo Auto-Retry 阈值一致). */
export const CAMEO_PASS = 75;

export function assessPromptReadiness(input: ReadinessInput): ReadinessReport {
  const hasCharacter = input.hasFace || input.usedKinds.includes('character');
  const hasStyle = input.usedKinds.includes('style');
  const len = (input.compiledPrompt || '').trim().length;
  const refTotal = input.refs.image + input.refs.audio + input.refs.video;

  const checks: ReadinessCheck[] = [
    { id: 'content', label: '创意 / 剧本内容充足', ok: len >= 20, weight: 30, hint: len >= 20 ? undefined : '再多写点剧情(≥20 字)' },
    { id: 'character', label: '锁定主角(跨镜一致性)', ok: hasCharacter, weight: 25, hint: hasCharacter ? undefined : '上传主角脸,或用 @ 引用角色资产' },
    { id: 'style', label: '指定风格(统一画风)', ok: hasStyle, weight: 15, hint: hasStyle ? undefined : '用 @ 引用风格资产,全片画风更统一' },
    { id: 'resolved', label: '引用全部匹配', ok: input.unresolvedCount === 0, weight: 15, hint: input.unresolvedCount ? `有 ${input.unresolvedCount} 个未匹配引用(将按裸名输出)` : undefined },
    { id: 'refs', label: '多模态参考(可选加分)', ok: refTotal > 0, weight: 5 },
  ];

  // cameo 试穿评分: 仅当上传了主角脸才计入 (复用 cameo-vision)
  if (input.hasFace) {
    const cs = input.cameoScore ?? null;
    checks.push({
      id: 'cameo',
      label: `主角脸试穿评分 ≥ ${CAMEO_PASS}`,
      ok: cs != null && cs >= CAMEO_PASS,
      weight: 10,
      hint: cs == null ? '评分中…' : cs >= CAMEO_PASS ? undefined : `当前 ${cs} 分,建议换更清晰的正脸`,
    });
  }

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = totalWeight === 0 ? 0 : Math.round((got / totalWeight) * 100);
  const level: ReadinessReport['level'] = score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';

  return { score, level, checks, compiledLength: len };
}
