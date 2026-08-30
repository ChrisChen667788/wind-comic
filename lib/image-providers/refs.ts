/**
 * v12.393:守卫守的是一个和被守方口径不同的数。
 *
 * v12.371 给 provider 加了 `minRefImages` 下界,让「0 参考图」的请求不要白试一次
 * MiniMax multi-ref。可 8/30 的定时任务日志里,那句报错照旧出现:
 *   `❌ 场景 万人演唱会现场  图像生成失败: Minimax multi-ref needs at least 1 ref | …`
 *
 * 原因是**同一个量被算了三遍,三种口径**:
 *   · `plugin-chain-router` 算 refCount:`.filter(u => !!u)`      —— 只要非空
 *   · minimax-multi 内部算 refs:`.filter(u => u.startsWith('http'))` + `Set` 去重 + 上限 4
 *   · gateway 内部算 refUrls:`.filter(u => u.startsWith('http'))` + 上限 4,**不去重**
 *
 * 于是传进来一个 `data:` URI 或 `/api/serve-file?...` 的本地引用图:
 * router 算出 1 → `minRefImages: 1` 满足 → 放行 → provider 内部过滤掉 → 抛错。
 * 守卫看的数和 provider 看的数从来不是一个数,那道下界等于没设。
 * (第二种差异同样真实:传三个相同 URL 时 router 算 3、minimax 去重后算 1。)
 *
 * 所以这里只做一件事:**把「有几张能用的参考图」变成一个函数**,
 * 判定方和使用方都问它。口径以 provider 的实际需求为准 ——
 * 能发给引擎的只有 http(s) 链接,重复的没有意义,超过上限的会被丢掉。
 */

export interface RefLike {
  referenceImages?: string[] | null;
  cref?: string | null;
  sref?: string | null;
}

/** 引擎单次能接受的参考图上限(minimax-multi 与 gateway 都是 4) */
export const MAX_REF_IMAGES = 4;

/**
 * 收敛出**真正会被发给引擎**的那些参考图。
 *
 * 顺序刻意保留 referenceImages → cref → sref,与两个 provider 原来的写法一致 ——
 * 去重时先出现的胜出,换顺序会改变发给引擎的首图,那是有视觉后果的。
 */
export function usableRefs(input: RefLike | null | undefined): string[] {
  const raw = [
    ...(input?.referenceImages || []),
    ...(input?.cref ? [input.cref] : []),
    ...(input?.sref ? [input.sref] : []),
  ];
  const http = raw.filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
  return Array.from(new Set(http)).slice(0, MAX_REF_IMAGES);
}

/** 选路阶段判 minRefImages / maxRefImages 用的就是这个数 —— 与 provider 实际拿到的张数一致 */
export function countUsableRefs(input: RefLike | null | undefined): number {
  return usableRefs(input).length;
}
