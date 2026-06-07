/**
 * lib/lipsync-qc (v9.7.5) — 口型质检回环决策(纯逻辑,复用 rebirth-plan)。
 *
 * 口型渲染后(已写回为该镜 video),跑一遍 Vision 质检 → 用本 lib 裁决:
 *   - 全部达标 → done;
 *   - 有弱镜 且 未到轮上限 → rerender(给出要重渲的镜号);
 *   - 有弱镜 且 已到轮上限 → stop(转人工)。
 * 弱镜识别复用 `buildRebirthPlan`(分数升序 + 阈值),只在其上加「轮次 + 限定本批镜」编排。
 * 单测 tests/v9-7-5-lipsync-qc.test.ts。
 */
import { buildRebirthPlan } from './rebirth-plan';

export type LipSyncQcDecision = 'done' | 'rerender' | 'stop';

export interface LipSyncQcVerdict {
  decision: LipSyncQcDecision;
  /** 本轮需重渲的镜号(升序,最弱在前) */
  weakShots: number[];
  round: number;
  threshold: number;
  message: string;
}

export interface LipSyncQcInput {
  /** 口型视频的 Vision 质检(至少含 shotNumber + score) */
  audits: Array<{ shotNumber: number; score: number }>;
  /** 弱镜阈值,默认 70 */
  threshold?: number;
  /** 当前轮次(1-based) */
  round: number;
  /** 最大重渲轮数,默认 2 */
  maxRounds?: number;
  /** 限定只评这些镜(本批口型镜);缺省评全部 */
  onlyShots?: number[];
  /** v9.7.8:口型-音频对齐分(shotNumber → 0-100,来自 lipsync-align);可选 */
  alignScores?: Record<number, number>;
  /** 对齐分弱阈值,默认 60 */
  alignThreshold?: number;
}

export function planLipSyncQc(input: LipSyncQcInput): LipSyncQcVerdict {
  const threshold = typeof input.threshold === 'number' ? input.threshold : 70;
  const maxRounds = input.maxRounds && input.maxRounds > 0 ? input.maxRounds : 2;
  const round = input.round;
  const onlySet = input.onlyShots && input.onlyShots.length ? new Set(input.onlyShots) : null;

  let audits = Array.isArray(input.audits) ? input.audits : [];
  if (onlySet) audits = audits.filter((a) => onlySet.has(a.shotNumber));

  // ① Vision 画面分弱镜(分数升序)
  const plan = buildRebirthPlan(audits, { threshold, maxShots: 100 });
  const visionWeak = plan.shots.map((s) => s.shotNumber);
  const visionSet = new Set(visionWeak);

  // ② v9.7.8 口型-音频对齐分弱镜(<alignThreshold,且不在 Vision 弱镜里,按对齐分升序)
  const alignThreshold = typeof input.alignThreshold === 'number' ? input.alignThreshold : 60;
  const alignScores = input.alignScores || {};
  const alignWeak = Object.keys(alignScores)
    .map(Number)
    .filter((sn) => Number.isFinite(sn) && alignScores[sn] < alignThreshold && !visionSet.has(sn) && (!onlySet || onlySet.has(sn)))
    .sort((a, b) => alignScores[a] - alignScores[b]);

  const weakShots = [...visionWeak, ...alignWeak];

  if (weakShots.length === 0) {
    return { decision: 'done', weakShots: [], round, threshold, message: `口型质检通过:画面 ≥ ${threshold} / 音画对齐 ≥ ${alignThreshold} ✓` };
  }
  const alignNote = alignWeak.length ? `,含 ${alignWeak.length} 镜音画对不上(<${alignThreshold})` : '';
  if (round < maxRounds) {
    return { decision: 'rerender', weakShots, round, threshold, message: `${weakShots.length} 镜口型偏弱${alignNote} — 第 ${round}/${maxRounds} 轮自动重渲` };
  }
  return { decision: 'stop', weakShots, round, threshold, message: `仍有 ${weakShots.length} 镜口型偏弱${alignNote},已达 ${maxRounds} 轮上限 — 转人工复核` };
}
