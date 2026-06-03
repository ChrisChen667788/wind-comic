/**
 * lib/rebirth-plan (v9.4.2) — Vision 重生闭环:把每镜质检结果 → 「该重拍哪些镜 + 怎么修」的计划。
 *
 * 阶段十五第二刀。Vision Audit 给每镜 0-100 分 + 4 维(场景/动作/情绪/构图)+ issues;
 * 这里把低分镜收成一个「一键重拍弱镜」批量计划:哪些镜 < 阈值、优先级(分低先拍)、
 * 最弱维度、针对性修补提示。供面板「一键重拍 N 个弱镜」入口 + 后续「一键成片」闭环自愈消费。
 *
 * 纯函数,不碰 DB / LLM,用本地最小输入形(与 vision-audit 解耦,结构兼容 ShotAuditResult)。
 * 单测 tests/v9-4-2-rebirth-plan.test.ts。
 */

export interface AuditedShotLike {
  shotNumber: number;
  score: number;
  verdict?: 'pass' | 'warn' | 'fail';
  dimensions?: { sceneMatch?: number; actionMatch?: number; moodMatch?: number; composition?: number };
  issues?: string[];
}

export type RebirthDimension = 'sceneMatch' | 'actionMatch' | 'moodMatch' | 'composition';

export interface RebirthShot {
  shotNumber: number;
  score: number;
  /** 1 = 最该先重拍(分最低) */
  priority: number;
  /** 最弱维度 key(无维度数据时 null) */
  weakestDimension: RebirthDimension | null;
  /** 针对性修补提示(中文) */
  focusHint: string;
  issues: string[];
}

export interface RebirthPlan {
  shots: RebirthShot[];
  count: number;
  threshold: number;
  message: string;
}

export interface RebirthOptions {
  /** 低于此分 → 进重拍计划。默认 75(= Vision pass 线) */
  threshold?: number;
  /** 最多列入几个(按优先级截断)。默认不限 */
  maxShots?: number;
}

const DIM_LABEL: Record<RebirthDimension, string> = {
  sceneMatch: '场景对剧本',
  actionMatch: '动作 / 姿态',
  moodMatch: '情绪 / 氛围',
  composition: '构图取景',
};

function num(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** 4 维里分最低的那个(给「重点修哪」)。无维度数据 → null。 */
function weakestDim(d?: AuditedShotLike['dimensions']): { key: RebirthDimension | null; score: number } {
  if (!d) return { key: null, score: 0 };
  const dims = (['sceneMatch', 'actionMatch', 'moodMatch', 'composition'] as const)
    .map((k) => ({ k, v: d[k] }))
    .filter((e): e is { k: RebirthDimension; v: number } => typeof e.v === 'number');
  if (!dims.length) return { key: null, score: 0 };
  const min = dims.reduce((a, b) => (b.v < a.v ? b : a));
  return { key: min.k, score: min.v };
}

function buildFocusHint(score: number, w: { key: RebirthDimension | null; score: number }, issues: string[]): string {
  const parts: string[] = [];
  if (w.key) parts.push(`重点修「${DIM_LABEL[w.key]}」(${w.score} 分)`);
  if (issues.length) parts.push(issues[0]);
  if (!parts.length) parts.push(score < 50 ? '整体跑题,建议重写该镜提示词后重拍' : '细节偏弱,微调提示词重拍');
  return parts.join(' · ');
}

/**
 * 把一组每镜质检结果 → 重拍计划。低于阈值的镜按分升序(最差先拍)排,标优先级、最弱维度、修补提示。
 */
export function buildRebirthPlan(shots: AuditedShotLike[], opts: RebirthOptions = {}): RebirthPlan {
  const threshold = opts.threshold ?? 75;
  const maxShots = opts.maxShots ?? Infinity;

  const candidates = (Array.isArray(shots) ? shots : [])
    .filter((s) => num(s.score) < threshold)
    .sort((a, b) => num(a.score) - num(b.score));

  const out: RebirthShot[] = candidates.slice(0, maxShots).map((s, i) => {
    const w = weakestDim(s.dimensions);
    const issues = Array.isArray(s.issues) ? s.issues.filter(Boolean).slice(0, 3) : [];
    return {
      shotNumber: s.shotNumber,
      score: num(s.score),
      priority: i + 1,
      weakestDimension: w.key,
      focusHint: buildFocusHint(num(s.score), w, issues),
      issues,
    };
  });

  const message = out.length === 0
    ? `全部镜头 ≥ ${threshold} 分,无需重拍 ✓`
    : `${out.length} 个镜头低于 ${threshold} 分 — 建议按优先级重拍`;

  return { shots: out, count: out.length, threshold, message };
}
