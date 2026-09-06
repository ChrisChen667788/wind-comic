/**
 * 导演评分的归一化(v12.425)。
 *
 * 起因:演示工程的顶栏真的显示过「评分 undefined/100」。原写法是
 * `review ? \`${review.overallScore}/100\` : '—'` —— 只判了对象在不在,
 * 没判分数在不在。评审跑了一半、旧项目只留了壳,就会把 undefined 打到界面上。
 *
 * 同样不能用 `Number(x)` 一把梭:Number(null) 和 Number('') 都是 0,
 * 「还没评分」会被显示成「0 分」—— 那是另一种说谎。
 */

/**
 * 有分返回数字,没分返回 null。调用方自己决定 null 显示成什么。
 *
 * 只认 number 和「非空的数字字符串」——不能反过来「排除已知的坏值」:
 * 第一版写的是 `raw == null || raw === ''` 加 Number(),结果 `Number([])` 是 0,
 * 空数组直接冒充成 0 分溜了过去(测试抓到的)。白名单才封得住。
 */
export function normalizeReviewScore(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
