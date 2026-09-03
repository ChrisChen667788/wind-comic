/**
 * lib/veo-scene-extension.ts — Veo Scene Extension 的规划与约束(v12.407)。
 *
 * ── 先把话说清楚:这是拼接,不是单次长镜 ──────────────────────────────
 * v12.401 的竞品复核里,我把「Veo 3.1 单次 60s+」写进了 README,被独立二次
 * 检索**当场推翻**:Veo 的 60s+ 是 **Scene Extension 续接**出来的,
 * **单次生成上限仍是 8–10 秒**。每一段新片基于上一段的**最后一秒**继续生成。
 *
 * 所以这个模块的命名、日志、返回值都刻意强调「段数」而不是「时长」——
 * 免得下一个读代码的人重犯我犯过的那个错。
 *
 * ── 官方约束(2026-09-03 核)──────────────────────────────────────────
 *   · 续接需要**前一次任务的 task_id**(不是视频 URL)——所以主生成流程必须留住它;
 *   · 每段仍是 8s 量级,最多链约 20 段 → 140 秒上下;
 *   · 续接是**独立端点**(`/veo-3.1-extend/generate` 形态),网关不一定暴露。
 *
 * ── 最要紧的一条工程约束 ──────────────────────────────────────────────
 * 续接失败时**绝不能把已经生成、已经计费的首段一起丢掉**。
 * 这个项目的老毛病就是「一处失败拖垮整体」——首段是真金白银出来的,
 * 续接不上就返回首段 + 说明,由调用方决定是接受短片还是重试。
 */

/** 官方约 20 段;这里留一档保守值,可用 env 调。 */
export const VEO_EXTEND_MAX_SEGMENTS = 20;
/** 单段量级(秒)。Veo 单次生成上限 8–10s —— 这个常量的存在就是为了提醒:长度不是靠它变大的。 */
export const VEO_SEGMENT_SEC = 8;

export interface ExtendPlan {
  /** 首段之外还要续接几次 */
  extendCount: number;
  /** 计划总时长(秒)—— 由段数乘出来,**不是**单次生成能力 */
  plannedSec: number;
  /** 因为超过链长上限而没能满足的时长 */
  shortfallSec: number;
}

export function planExtension(targetSec: number, segmentSec = VEO_SEGMENT_SEC, maxSegments = VEO_EXTEND_MAX_SEGMENTS): ExtendPlan {
  const seg = Math.max(1, Math.round(segmentSec));
  const want = Math.max(seg, Math.round(targetSec || seg));
  const wantSegments = Math.ceil(want / seg);
  const segments = Math.min(wantSegments, Math.max(1, Math.round(maxSegments)));
  return {
    extendCount: Math.max(0, segments - 1),
    plannedSec: segments * seg,
    shortfallSec: Math.max(0, want - segments * seg),
  };
}

/** 「这个错误是不是在说『网关没有续接端点』」—— 那不该被当成生成失败。 */
export function isExtendUnsupported(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b404\b/.test(message) ||
    m.includes('not found') ||
    m.includes('unsupported') ||
    m.includes('no such endpoint') ||
    m.includes('unknown path')
  );
}

export interface ExtendOutcome {
  /** 最终可用的视频 URL —— 续接失败时是**首段**,不是空 */
  videoUrl: string;
  /** 实际拿到的段数(1 = 只有首段) */
  segments: number;
  /** 实际时长(段数 × 单段量级),仅为估算 */
  approxSec: number;
  /** 中断原因(成功走完为 undefined) */
  stoppedBecause?: string;
}
