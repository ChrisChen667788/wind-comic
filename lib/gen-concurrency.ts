/**
 * 阶段二十八 v12.32.0 — 可调生成并发(纯函数,可单测)。
 *
 * 此前场景/分镜/视频三阶段的并发数硬编码 = 2。本模块让它**可配**:
 *   - 单阶段:GEN_CONCURRENCY_SCENE / GEN_CONCURRENCY_STORYBOARD / GEN_CONCURRENCY_VIDEO
 *   - 全局兜底:GEN_CONCURRENCY(单阶段未设时生效)
 *   - 都不设 → 默认 2(与旧版逐字节一致,零回归)
 *
 * ⚠️ 视频阶段的诚实权衡:每镜会取「上一镜真末帧」做关键帧链(跨镜衔接)。并发越高,
 * 链命中越少(N+1 启动时 N 还没出末帧)→ 速度↑但跨镜连贯性↓。需强衔接的项目维持低并发(1–2)。
 */

export type GenStage = 'scene' | 'storyboard' | 'video';

const DEFAULTS: Record<GenStage, number> = { scene: 2, storyboard: 2, video: 2 };
const MIN = 1;
const MAX = 8; // 上限护栏:再高也容易撞上游限流/超预算,收益递减

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 解析某阶段并发数:单阶段 env > 全局 env > 默认 2,夹到 [1,8];
 * 给了 itemCount 时不超过任务数(开 4 路并发跑 2 个任务没意义)。
 */
export function resolveConcurrency(stage: GenStage, itemCount?: number): number {
  const perStage = parsePositiveInt(process.env[`GEN_CONCURRENCY_${stage.toUpperCase()}`]);
  const global = parsePositiveInt(process.env.GEN_CONCURRENCY);
  let n = perStage ?? global ?? DEFAULTS[stage];
  n = Math.max(MIN, Math.min(MAX, n));
  if (typeof itemCount === 'number' && itemCount > 0) n = Math.min(n, itemCount);
  return n;
}

export const GEN_CONCURRENCY_MAX = MAX;
export const GEN_CONCURRENCY_DEFAULTS = DEFAULTS;
