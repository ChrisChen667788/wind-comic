/**
 * lib/quality-gate (v9.4.0) — 成片质量门禁: 综合 Vision 每镜质检 + 成片 3 维评分 → 发布就绪判定.
 *
 * 阶段十五「质量与一致性深化」第一刀。把零散的质量信号收成一个「能不能发/导出」的裁决:
 *   - Vision 每镜质检 (lib/vision-audit 的 FilmAuditSummary): 画面对不对得上剧本 (avgScore / fail 比例 / verdict)
 *   - 成片 3 维评分 (lib/quality-scores 的 QualityScoreDimensions): 连贯 / 光影 / 脸 一致性
 * → pass (达标) / warn (放行但有弱点) / block (严重不达标, 建议先重拍再发)。
 *
 * 纯函数, 不碰 DB / LLM, client 可直引。输入用本地最小形 (与 vision-audit/quality-scores 解耦)。
 * 单测 tests/v9-4-0-quality-gate.test.ts。
 */

/** Vision 每镜质检聚合的最小形 (对齐 vision-audit.FilmAuditSummary)。 */
export interface FilmAuditLike {
  avgScore: number;
  shotCount: number;
  failCount: number;
  weakestShots: Array<{ shotNumber: number; score: number }>;
  verdict: 'excellent' | 'good' | 'needs-work' | 'poor';
}

/** 成片 3 维评分的最小形 (对齐 quality-scores.QualityScoreDimensions)。 */
export interface QualityDimsLike {
  overall: number;
  continuity: number;
  lighting: number;
  face: number;
}

/** 口型就绪度的最小形 (对齐 lipsync-plan.LipSyncPlan;v9.6.4 融门禁)。 */
export interface LipSyncGateLike {
  /** 对白镜数;0 → 无对白, 不参与门禁 */
  lines: number;
  /** 整片口型就绪度 0-100 */
  readiness: number;
  /** none/pass/warn/block */
  level: 'none' | 'pass' | 'warn' | 'block';
}

/** 口型-音频对齐(实测,v9.7.14)的最小形;measuredShots=0 → 未测, 不参与门禁。 */
export interface LipAudioAlignLike {
  /** 已实测对齐的镜数 */
  measuredShots: number;
  /** 对齐分低于阈值的镜数 */
  weakShots: number;
  /** 平均对齐分 0-100 */
  avgScore: number;
}

export interface QualityGateThresholds {
  /** Vision 平均分门槛, 低于 → warn。默认 70 */
  minAvgScore: number;
  /** 允许的 fail 镜比例, 超过 → block。默认 0.1 */
  maxFailRatio: number;
  /** 成片综合分门槛, 低于 → warn。默认 70 */
  minQualityOverall: number;
  /** 成片综合分硬线, 低于 → block。默认 50 */
  blockQualityOverall: number;
  /** 单维度偏弱阈值, 低于 → 进 failedDimensions。默认 70 */
  weakDimThreshold: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityGateThresholds = {
  minAvgScore: 70,
  maxFailRatio: 0.1,
  minQualityOverall: 70,
  blockQualityOverall: 50,
  weakDimThreshold: 70,
};

export type QualityGateLevel = 'pass' | 'warn' | 'block';

export interface QualityGateResult {
  level: QualityGateLevel;
  /** pass / warn → 可发布; block → 建议先重拍 */
  ready: boolean;
  /** 不达标 / 提示原因 (中文) */
  reasons: string[];
  /** 最弱的若干镜 (来自 Vision), 给「一键重拍」 */
  weakestShots: Array<{ shotNumber: number; score: number }>;
  /** 偏弱维度 (连贯/光影/脸 + 画面对剧本) */
  failedDimensions: string[];
  /** 一句话总结 */
  message: string;
}

const DIM_LABEL: Record<keyof Omit<QualityDimsLike, 'overall'>, string> = {
  continuity: '连贯',
  lighting: '光影',
  face: '脸一致',
};

function num(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * 综合 Vision 质检 + 成片评分 → 发布就绪裁决。两者皆缺 → warn(先去质检)。
 * level 取最严: 任一 block-原因 → block; 否则有 warn-原因 → warn; 否则 pass。
 */
export function evaluateQualityGate(input: {
  filmAudit?: FilmAuditLike | null;
  qualityScore?: QualityDimsLike | null;
  lipSync?: LipSyncGateLike | null;
  lipAudioAlign?: LipAudioAlignLike | null;
  thresholds?: Partial<QualityGateThresholds>;
}): QualityGateResult {
  const t = { ...DEFAULT_QUALITY_THRESHOLDS, ...(input.thresholds || {}) };
  const fa = input.filmAudit || null;
  const qs = input.qualityScore || null;
  const ls = input.lipSync || null;
  const lsActive = !!ls && num(ls.lines) > 0;
  const la = input.lipAudioAlign || null;
  const laActive = !!la && num(la.measuredShots) > 0;

  const blockReasons: string[] = [];
  const warnReasons: string[] = [];
  const failedDimensions: string[] = [];
  const weakestShots = fa && Array.isArray(fa.weakestShots) ? fa.weakestShots.slice(0, 3) : [];

  if (!fa && !qs && !lsActive && !laActive) {
    return {
      level: 'warn', ready: true,
      reasons: ['尚无质检 / 成片评分数据 — 建议先跑 Vision 质检与成片打分再发布'],
      weakestShots: [], failedDimensions: [],
      message: '未质检 · 建议先跑质检',
    };
  }

  // ── Vision 每镜质检 ──
  if (fa && fa.shotCount > 0) {
    const failRatio = num(fa.failCount) / fa.shotCount;
    if (failRatio > t.maxFailRatio) {
      blockReasons.push(`${fa.failCount}/${fa.shotCount} 镜严重跑题 (${Math.round(failRatio * 100)}% > ${Math.round(t.maxFailRatio * 100)}%)`);
      failedDimensions.push('画面对剧本');
    }
    if (fa.verdict === 'poor') blockReasons.push('Vision 质检评级 poor');
    else if (fa.verdict === 'needs-work') warnReasons.push('Vision 质检评级 needs-work');
    if (num(fa.avgScore) < t.minAvgScore && failRatio <= t.maxFailRatio) {
      warnReasons.push(`Vision 平均分 ${Math.round(num(fa.avgScore))} < ${t.minAvgScore}`);
    }
  }

  // ── 成片 3 维评分 ──
  if (qs) {
    const overall = num(qs.overall);
    if (overall < t.blockQualityOverall) {
      blockReasons.push(`成片综合分 ${overall} < 硬线 ${t.blockQualityOverall}`);
    } else if (overall < t.minQualityOverall) {
      warnReasons.push(`成片综合分 ${overall} < ${t.minQualityOverall}`);
    }
    for (const dim of ['continuity', 'lighting', 'face'] as const) {
      if (num(qs[dim]) < t.weakDimThreshold) {
        failedDimensions.push(`${DIM_LABEL[dim]} ${num(qs[dim])}`);
        const r = `${DIM_LABEL[dim]}维度偏低 (${num(qs[dim])} < ${t.weakDimThreshold})`;
        if (!warnReasons.includes(r)) warnReasons.push(r);
      }
    }
  }

  // ── 口型就绪度 (v9.6.4 融门禁) ──
  // 口型是「增强」维度: 对不上只升到 warn (不硬拦发布), 但要在门禁里显形 + 进偏弱维度。
  if (lsActive && ls) {
    if (ls.level === 'block') {
      warnReasons.push(`口型多处对不上 (就绪度 ${Math.round(num(ls.readiness))})`);
      if (!failedDimensions.includes('口型')) failedDimensions.push('口型');
    } else if (ls.level === 'warn') {
      warnReasons.push(`口型部分对不上 (就绪度 ${Math.round(num(ls.readiness))})`);
      if (!failedDimensions.includes('口型')) failedDimensions.push('口型');
    }
  }

  // ── 口型-音频对齐(实测,v9.7.14)──「增强」维度,只升 warn。
  if (laActive && la) {
    if (num(la.weakShots) > 0) {
      warnReasons.push(`口型-音频对齐:${num(la.weakShots)}/${num(la.measuredShots)} 镜对不上声音 (均分 ${Math.round(num(la.avgScore))})`);
      if (!failedDimensions.includes('口型对齐')) failedDimensions.push('口型对齐');
    } else if (num(la.avgScore) < 75) {
      warnReasons.push(`口型-音频对齐均分偏低 (${Math.round(num(la.avgScore))})`);
      if (!failedDimensions.includes('口型对齐')) failedDimensions.push('口型对齐');
    }
  }

  let level: QualityGateLevel;
  if (blockReasons.length) level = 'block';
  else if (warnReasons.length) level = 'warn';
  else level = 'pass';

  const reasons = [...blockReasons, ...warnReasons];
  const message =
    level === 'pass' ? '达发布标准 ✓'
      : level === 'warn' ? `可发布, 但有 ${reasons.length} 处可优化`
        : `建议先重拍: ${blockReasons.length} 处严重不达标`;

  return { level, ready: level !== 'block', reasons, weakestShots, failedDimensions, message };
}
