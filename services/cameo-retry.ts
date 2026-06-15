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
/** v12.2.8: 最多重生次数 1→2;第 2 次升级策略(更高 cw + 更多 sref),仍不达标 → 标人审 */
export const CAMEO_RETRY_MAX_ATTEMPTS = 2;

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
  /**
   * v2.12 Phase 3: 同一镜头里出现的其他锁定角色 (除 referenceImageUrl 这个 primary 外)。
   * 每个会独立跑一次 vision scoring,综合分数取 **min**(防"主角好,配角崩")。
   * 留空 → 退化为 Phase 1/2 的单角色评分,行为完全不变(backward compat)。
   *
   * 来源:`pickConsistencyRefs(...).extraCrefs` 拼上对应 lockedCharacter.name。
   */
  additionalReferences?: Array<{ url: string; name?: string }>;
}

export interface CameoRetryOutcome {
  /** 是否真的发起了重生 */
  retried: boolean;
  /** 一共生成了几次 (1 = 没重生, 2 = 重生一次) */
  attempts: number;
  /** 最终采用的图 URL */
  finalImageUrl: string;
  /**
   * 最终对应的 vision 分数 (0-100). 如果两次 vision 都失败则 null。
   *
   * Phase 3:多角色场景下这里返回 **min** 分数 (反映最弱一环);
   * `perCharacterScores` 拿到细分。
   */
  finalScore: number | null;
  /** 第一次评估的分数 (用于日志/分析). Phase 3 多角色 → min */
  firstScore: number | null;
  /** 重生时实际用的 cw (== originalCw 表示没动 / 已封顶) */
  finalCw: number;
  /** Vision LLM 给的解释, 给 UI tooltip 用 (取 min 分对应那条) */
  reasoning: string;
  /**
   * 跳过原因 (没有 ref / vision 失败 / 已经达标), 仅日志用。
   * 'ok' 表示进了流程, 'no-ref' 表示连判都没判。
   */
  skipReason: 'ok' | 'no-ref' | 'vision-null' | 'above-threshold';
  /**
   * v2.12 Phase 3: 多角色镜头每个角色的独立分数 (按 [primary, ...additional] 顺序)。
   * 单角色镜头 (additionalReferences 为空) 时省略此字段以保持 outcome 体积。
   */
  perCharacterScores?: Array<{ name?: string; score: number | null; reasoning: string }>;
  /**
   * v12.2.8: 所有重生跑完后最终分仍 < 阈值 → true,建议人工复核(UI 标「待复核」)。
   * 达标 / 无参考 / vision 全挂(无分可判)→ false。
   */
  needsHumanReview: boolean;
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

  // ── v2.12 Phase 3: 多角色 refs 聚合 ─────────────────────────────
  // 单角色镜头 → allRefs.length === 1, 一切退化为原 single-ref 行为(完全 backward-compat)。
  // 多角色镜头 → 每个 ref 独立跑 vision scoring, 综合分数取 min(最弱一环决定是否重生)。
  const allRefs: Array<{ url: string; name?: string }> = [
    { url: input.referenceImageUrl, name: input.characterName },
    ...(input.additionalReferences || []).filter(r => r && r.url),
  ];
  const isMulti = allRefs.length > 1;

  // 第一次评分 — 并行,避免多角色把延迟拉成 N 倍
  const firstResults = await Promise.all(
    allRefs.map(ref => scoreShotConsistency(input.shotImageUrl, ref.url, ref.name)),
  );
  const firstPerChar = allRefs.map((ref, i) => ({
    name: ref.name,
    score: firstResults[i]?.score ?? null,
    reasoning: firstResults[i]?.reasoning || '',
  }));

  // 全部 vision 都挂 — 没数据不冒险, 跳过
  const validFirst = firstResults
    .map((r, i) => (r ? { result: r, name: allRefs[i].name } : null))
    .filter((x): x is { result: ShotConsistencyResult; name: string | undefined } => x !== null);
  if (validFirst.length === 0) {
    console.log(`${tag} vision-null on first eval (all ${allRefs.length} ref(s)), skip retry`);
    const out = baseOutcome(input, 'vision-null', null);
    if (isMulti) out.perCharacterScores = firstPerChar;
    return out;
  }

  // 取 min 角色作为门控 (反映最弱一环) — 用 Math.min 后 find 对应条目,绕开 reduce 的 TS 推导
  const firstMinScoreVal = Math.min(...validFirst.map(x => x.result.score));
  const firstWorst = validFirst.find(x => x.result.score === firstMinScoreVal) || validFirst[0]!;
  const firstMinScore = firstWorst.result.score;
  const firstMinReasoning = firstWorst.result.reasoning;

  // 已达标 — 全部角色都 ≥ 阈值才放行 (使用 min 即可)
  if (firstMinScore >= threshold) {
    console.log(`${tag} min ${firstMinScore} ≥ ${threshold}${isMulti ? ` (across ${allRefs.length} chars)` : ''}, no retry`);
    const out = baseOutcome(input, 'above-threshold', firstWorst.result);
    if (isMulti) out.perCharacterScores = firstPerChar;
    return out;
  }

  // ── v12.2.8 触发重生(最多 CAMEO_RETRY_MAX_ATTEMPTS 次,逐次升级 cw + sref;keep-best 回滚)──
  // best 初始 = 原图 + 第一次分;每次重生分更高才采用(否则保留=回滚),达标即停;跑完仍不达标 → 人审。
  let bestImage = input.shotImageUrl;
  let bestScore: number = firstMinScore;
  let bestCw = input.originalCw;
  let bestReasoning = firstMinReasoning;
  let bestPerChar = firstPerChar;
  let attempts = 1;
  let trustedNull = false; // 某次重生 vision 全挂 → 信任该新图(无分可判)

  for (let k = 1; k <= CAMEO_RETRY_MAX_ATTEMPTS; k++) {
    // 逐次升级:cw 步进 k×boost(封顶 125);sref 取最近 (1+k) 张(k1→2, k2→3,第 2 次更狠)
    const boostedCw = Math.min(CAMEO_CW_MAX, input.originalCw + k * CAMEO_RETRY_CW_BOOST);
    const extraRefs = (input.sameCharacterRecentShots || []).slice(-(1 + k));
    console.log(`${tag} attempt ${k}/${CAMEO_RETRY_MAX_ATTEMPTS}: best ${bestScore} < ${threshold}, retry cw ${input.originalCw}→${boostedCw}, +${extraRefs.length} ref(s)`);

    attempts = 1 + k; // 计这次尝试(即便重生抛错也算尝试过)
    let regenUrl: string;
    try {
      regenUrl = await input.regenerate(boostedCw, extraRefs);
    } catch (e) {
      console.warn(`${tag} regenerate threw on attempt ${k}, keep best so far. err:`, e instanceof Error ? e.message : e);
      break; // 重生失败 → 停,保最优
    }

    const results = await Promise.all(allRefs.map(ref => scoreShotConsistency(regenUrl, ref.url, ref.name)));
    const perChar = allRefs.map((ref, i) => ({ name: ref.name, score: results[i]?.score ?? null, reasoning: results[i]?.reasoning || '' }));
    const valid = results
      .map((r, i) => (r ? { result: r, name: allRefs[i].name } : null))
      .filter((x): x is { result: ShotConsistencyResult; name: string | undefined } => x !== null);

    if (valid.length === 0) {
      // 本次 vision 全挂 — 信任新图(花了钱,默认更好),无分可判 → 停
      console.log(`${tag} attempt ${k} vision-null, trust regen image`);
      bestImage = regenUrl; bestCw = boostedCw; bestPerChar = perChar; trustedNull = true;
      break;
    }

    const minScore = Math.min(...valid.map(x => x.result.score));
    const worst = valid.find(x => x.result.score === minScore) || valid[0]!;
    if (minScore > bestScore) {
      bestImage = regenUrl; bestScore = minScore; bestCw = boostedCw;
      bestReasoning = worst.result.reasoning || bestReasoning; bestPerChar = perChar;
      console.log(`${tag} attempt ${k} improved → ${minScore} (worst: ${worst.name || '?'})`);
    } else {
      console.log(`${tag} attempt ${k} min ${minScore} ≤ best ${bestScore}, keep best (rollback)`);
    }
    if (bestScore >= threshold) break; // 达标即停,不浪费第 2 次
  }

  const needsHumanReview = !trustedNull && bestScore < threshold;
  const improved = bestImage !== input.shotImageUrl;
  return {
    retried: true,
    attempts,
    finalImageUrl: bestImage,
    finalScore: trustedNull ? null : bestScore,
    firstScore: firstMinScore,
    finalCw: bestCw,
    reasoning: needsHumanReview
      ? `${attempts - 1} 次重生后仍 ${bestScore} < ${threshold},建议人工复核`
      : (improved ? bestReasoning : `重生未超过原图 (${firstMinScore}),已保留原图`),
    skipReason: 'ok',
    needsHumanReview,
    ...(isMulti ? { perCharacterScores: bestPerChar } : {}),
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
    needsHumanReview: false, // v12.2.8: 达标/无参考/vision 全挂 → 不标人审
  };
}
