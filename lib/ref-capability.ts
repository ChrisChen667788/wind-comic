/**
 * lib/ref-capability — 哪个引擎能吃几张角色参考图,吃不下的**必须说出来**(v12.447)。
 *
 * 用户传了 4 张角度图,引擎只收 1 张 —— 这件事本身没问题(不同引擎能力不同),
 * **没说出来才是问题**:用户以为多角度生效了,实际上出片只用了一张正面图,
 * 跨镜角色漂移照旧,而他找不到原因。本仓对这类「静默降级」零容忍(v12.433/12.344 同源)。
 *
 * 纯函数:给引擎名与每个角色的参考图数量,算出**用了几张、丢了几张、为什么**。
 */

export type RefEngine = 'kling' | 'minimax' | 'veo' | 'happyhorse' | 'seedance' | string;

export interface RefUsage {
  engine: RefEngine;
  /** 每角色实际会被发出去的图片数(含正面图) */
  perCharacter: number;
  used: number;
  dropped: number;
  /** v12.448:引擎一张都没收的角色数(S2V-01 默认只锁第 1 个角色) */
  unlocked: number;
  /** 中文原因,直接进日志与 SSE */
  reason: string;
}

/**
 * 每角色能收的图片总数(含正面图)。
 * - kling:Elements 模式 1 正面 + 3 参考(需 KLING_ELEMENTS=1 且账号开通套餐)
 * - minimax:v1 S2V-01 每主体单图(官方口径)。H3 能收 9 张,但**只能按量付费** ——
 *   Token Plan 订阅与积分都调不动它(2026-09-18 核官方文档 + 实探报 2013「暂不支持 MiniMax-H3 系列」),
 *   故这里不按 H3 算容量;H3 适配另起版本。S2V-01 同日实探过了套餐校验(缺参时报的是参数错误而非套餐不支持)。
 * - 其余:按单图算,宁可少报也不虚报
 */
export function perCharacterCapacity(engine: RefEngine, env: Record<string, string | undefined> = process.env): number {
  if (engine === 'kling') return env.KLING_ELEMENTS === '1' ? 4 : 1;
  return 1;
}

/** 统计某一镜的参考图使用情况;`refCounts` 是每个角色除正面图外的角度图张数 */
export function refUsageFor(engine: RefEngine, refCounts: number[], env?: Record<string, string | undefined>): RefUsage {
  const cap = perCharacterCapacity(engine, env);
  // v12.448 更正:S2V-01 默认**只锁第 1 个角色**(MINIMAX_S2V_MAX_SUBJECTS,v12.9.0 起的有意取舍:锁好一个 > 两个都飘),
  // 其余角色连正面图都不发。v12.447 按「每个角色 1 张」算,少报了。
  const maxSubjects = engine === 'minimax' ? Math.max(1, Number((env ?? process.env).MINIMAX_S2V_MAX_SUBJECTS) || 1) : Infinity;
  const offered = refCounts.reduce((n, c) => n + 1 + Math.max(0, c), 0);   // 正面图 + 角度图
  let used = 0, dropped = 0, unlocked = 0;
  refCounts.forEach((c, i) => {
    const angles = Math.max(0, c);
    if (i >= maxSubjects) { unlocked++; dropped += angles; return; }
    const sent = Math.min(1 + angles, cap);
    used += sent;
    dropped += 1 + angles - sent;
  });
  // `dropped` 只数**角度图**(用户在 v12.447 界面里主动加的那些);没被锁的角色另记 unlocked ——
  // 否则没传任何角度图的多角色镜头也会每镜报一次,那是 v12.9.0 的既定取舍,不是新丢的东西。
  const lockNote = unlocked ? `(另有 ${unlocked} 个角色没被锁,连正面图都没发)` : '';
  const reason = dropped === 0
    ? `${engine} 接收全部 ${offered - unlocked} 张参考图${lockNote}`
    : engine === 'kling' && cap === 1
      ? `可灵 Elements 未开启(KLING_ELEMENTS=1 且需对应套餐)—— 每角色只发 1 张正面图,已忽略 ${dropped} 张角度图`
      : engine === 'minimax'
        ? `MiniMax 旧接口 S2V-01 ${maxSubjects === 1 ? '默认只锁第 1 个角色' : `只锁前 ${maxSubjects} 个角色`}、每个只收 1 张正面图 —— 已忽略 ${dropped} 张角度图${lockNote}(H3 可收 9 张,但只能按量付费,Token Plan 订阅调不动)`
        : `${engine} 每角色只收 ${cap} 张 —— 已忽略 ${dropped} 张角度图`;
  return { engine, perCharacter: cap, used, dropped, unlocked, reason };
}

/**
 * 这一镜要不要上报:没有角色、或一张都没丢 → null(别制造噪音)。
 * `subjects` 是即将发给引擎的主体参考,每项的 `refImageUrls` 是正面图之外的角度图。
 */
export function refDropFor(
  engine: RefEngine, subjects: ReadonlyArray<{ refImageUrls?: string[] }>, env?: Record<string, string | undefined>,
): RefUsage | null {
  if (!subjects.length) return null;
  const usage = refUsageFor(engine, subjects.map((s) => (s.refImageUrls || []).length), env);
  return usage.dropped > 0 ? usage : null;
}
