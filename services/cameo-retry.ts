/**
 * Cameo Vision Auto-Retry · Sprint A.1 (v2.12)
 *
 * 一致性自动闭环: 给定一张刚生成的镜头图, 用 vision 比对它和角色参考图;
 * 若分数低于阈值, 自动用更强的 cw + 多 sref 重画一次。
 *
 * 决策日志见 ROADMAP_V4.md §7:
 *   · 阈值 75 (低于触发重生)
 *   · 单次重生 (避免无限循环 / token 浪费)
 *   · cw 提升策略: +25 ceiling 125 (MJ 上限)
 *
 * 不依赖 orchestrator —— 纯函数 + 一个生成器回调, 便于单测。
 *
 * 调用方 (orchestrator) 在 storyboard 渲染完毕后调:
 *
 *   const outcome = await evaluateAndRetry({
 *     shotImageUrl,
 *     referenceImageUrl,
 *     characterName,
 *     originalCw,
 *     regenerate: async (boostedCw, extraRefs) => imageGenerator(...)
 *   });
 *   storyboard.cameoScore   = outcome.finalScore;
 *   storyboard.cameoRetried = outcome.retried;
 *   storyboard.cameoAttempts = outcome.attempts;
 */

import { scoreShotConsistency, type ShotConsistencyResult } from '@/lib/cameo-vision';

/** Sprint A.1 决策值 — 改这里就改全管线行为, 不要散落到 orchestrator */
export const CAMEO_RETRY_THRESHOLD = 75;
/** cw 提升步长 (锁脸 125 已封顶, 此时只增加 sref 而不动 cw) */
export const CAMEO_RETRY_CW_BOOST = 25;
/** MJ cw 物理上限 */
export const CAMEO_CW_MAX = 125;
/** 最多重生次数, 防止 vision 抖动反复打分 */
export const CAMEO_RETRY_MAX_ATTEMPTS = 1;

export interface CameoRetryInput {
  /** 第一次生成出来的镜头图 URL */
  shotImageUrl: string;
  /** 角色参考图 URL (cref 选取的那张) — 缺失时直接 noop */
  referenceImageUrl: string | undefined;
  /** 角色名, 给 vision LLM 上下文用 */
  characterName?: string;
  /** 第一次用的 cw */
  originalCw: number;
  /**
   * 重生函数 — 由 orchestrator 注入, 拿到 boost 后的 cw 和 (可选) 额外 sref 链, 出图。
   * 返回值: 重生后的图 URL。失败请抛错或返回原图都行, 上游会兜底。
   */
  regenerate: (
    boostedCw: number,
    extraReferenceImages: string[],
  ) => Promise<string>;
  /** 可选: 同角色已经成功的镜头图, 用作重生时的额外 sref(增强一致性链) */
  sameCharacterRecentShots?: string[];
  /** 可选: shot 编号, 仅用于日志 */
  shotNumber?: number;
  /** 可选: 自定义阈值 (测试用), 默认 CAMEO_RETRY_THRESHOLD */
  threshold?: number;
}

export interface CameoRetryOutcome {
  /** 是否真的发起了重生 */
  retried: boolean;
  /** 一共生成了几次 (1 = 没重生, 2 = 重生一次) */
  attempts: number;
  /** 最终采用的图 URL */
  finalImageUrl: string;
  /** 最终对应的 vision 分数 (0-100). 如果两次 vision 都失败则 null */
  finalScore: number | null;
  /** 第一次评估的分数 (用于日志/分析) */
  firstScore: number | null;
  /** 重生时实际用的 cw (== originalCw 表示没动 / 已封顶) */
  finalCw: number;
  /** Vision LLM 给的解释, 给 UI tooltip 用 */
  reasoning: string;
  /**
   * 跳过原因 (没有 ref / vision 失败 / 已经达标), 仅日志用。
   * 'ok' 表示进了流程, 'no-ref' 表示连判都没判。
   */
  skipReason: 'ok' | 'no-ref' | 'vision-null' | 'above-threshold';
}

/**
 * 主入口 — 评分一次, 不达标就重生一次, 返回最终结果。
 *
 * 设计取舍:
 *   · 第二次 vision 失败时, 信任新图 (退一步保守)
 *   · 第一次 vision 失败时, 完全跳过重生 (没数据不冒险, 避免无意义出图)
 *   · 即使重生后分数更低, 也保留原图 (回滚) — 防止 LLM 抖动让用户看到更糟的图
 */
export async function evaluateAndRetry(input: CameoRetryInput): Promise<CameoRetryOutcome> {
  const threshold = input.threshold ?? CAMEO_RETRY_THRESHOLD;
  const tag = `[Cameo Retry] shot ${input.shotNumber ?? '?'}`;

  // 没有参考图 — 谈不上一致性, 直接放行
  if (!input.referenceImageUrl) {
    return baseOutcome(input, 'no-ref', null);
  }

  // 第一次评分
  const first = await scoreShotConsistency(
    input.shotImageUrl,
    input.referenceImageUrl,
    input.characterName,
  );
  if (!first) {
    console.log(`${tag} vision-null on first eval, skip retry`);
    return baseOutcome(input, 'vision-null', null);
  }

  // 已达标 — 直接返回
  if (first.score >= threshold) {
    console.log(`${tag} ${first.score} ≥ ${threshold}, no retry`);
    return baseOutcome(input, 'above-threshold', first);
  }

  // ── 触发重生 ────────────────────────────────────────────────
  const boostedCw = Math.min(CAMEO_CW_MAX, input.originalCw + CAMEO_RETRY_CW_BOOST);
  const extraRefs = (input.sameCharacterRecentShots || []).slice(-2);
  console.log(
    `${tag} ${first.score} < ${threshold}, retry with cw ${input.originalCw}→${boostedCw}, +${extraRefs.length} ref(s). reason: ${first.reasoning || '(no reason)'}`,
  );

  let regenUrl: string;
  try {
    regenUrl = await input.regenerate(boostedCw, extraRefs);
  } catch (e) {
    // 重生彻底失败 — 用原图兜底, 但记一下 outcome 是 retried
    console.warn(`${tag} regenerate threw, fallback to original. err:`, e instanceof Error ? e.message : e);
    return {
      retried: true,
      attempts: 2,
      finalImageUrl: input.shotImageUrl,
      finalScore: first.score,
      firstScore: first.score,
      finalCw: input.originalCw,
      reasoning: first.reasoning,
      skipReason: 'ok',
    };
  }

  // 第二次评分
  const second = await scoreShotConsistency(regenUrl, input.referenceImageUrl, input.characterName);
  if (!second) {
    // 第二次 vision 挂了 — 信任新图 (因为我们花钱重生了, 大概率比原图好)
    console.log(`${tag} second vision-null, trust regen image`);
    return {
      retried: true,
      attempts: 2,
      finalImageUrl: regenUrl,
      finalScore: null,
      firstScore: first.score,
      finalCw: boostedCw,
      reasoning: first.reasoning,
      skipReason: 'ok',
    };
  }

  // 重生后分数反而更低 → 回滚到原图 (LLM 抖动保护)
  if (second.score < first.score) {
    console.log(`${tag} regen ${second.score} < first ${first.score}, ROLLBACK to original`);
    return {
      retried: true,
      attempts: 2,
      finalImageUrl: input.shotImageUrl,
      finalScore: first.score,
      firstScore: first.score,
      finalCw: input.originalCw,
      reasoning: `重生后反而更差 (${first.score}→${second.score}), 已回滚`,
      skipReason: 'ok',
    };
  }

  console.log(`${tag} regen ${first.score}→${second.score} ✓ (cw ${input.originalCw}→${boostedCw})`);
  return {
    retried: true,
    attempts: 2,
    finalImageUrl: regenUrl,
    finalScore: second.score,
    firstScore: first.score,
    finalCw: boostedCw,
    reasoning: second.reasoning || first.reasoning,
    skipReason: 'ok',
  };
}

/** 跳过 retry 时的统一返回, 把 vision 给的 (如果有) 分数挂上 */
function baseOutcome(
  input: CameoRetryInput,
  reason: CameoRetryOutcome['skipReason'],
  result: ShotConsistencyResult | null,
): CameoRetryOutcome {
  return {
    retried: false,
    attempts: 1,
    finalImageUrl: input.shotImageUrl,
    finalScore: result?.score ?? null,
    firstScore: result?.score ?? null,
    finalCw: input.originalCw,
    reasoning: result?.reasoning || '',
    skipReason: reason,
  };
}
