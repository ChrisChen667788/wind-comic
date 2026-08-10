/**
 * lib/relative-time — 相对时间文案(纯函数,零依赖)。
 *
 * v12.301 抽出。此前仓里已有**两份**几乎一样的内联实现
 * (`components/polish/PolishHistoryPanel.tsx`、`components/polish/LatestPolishBanner.tsx`),
 * 两者在「超过一天怎么显示」上还不一致(一个带时分、一个只到日)。
 * Dashboard 要用时,与其写第三份,不如收口 —— 这个仓被「同一逻辑多份实现」坑过太多次
 * (转场两套、音色三套、称谓词表五处)。
 *
 * @param input 时间戳(ISO 字符串 / Date / 毫秒数)
 * @param now   注入当前时间,便于测试(默认 Date.now())
 * @param opts  withTime: 超过一天时是否带时分(PolishHistoryPanel 的口径)
 */
export function timeAgoZh(
  input: string | number | Date | null | undefined,
  now: number = Date.now(),
  opts: { withTime?: boolean } = {},
): string {
  if (input === null || input === undefined || input === '') return '';
  let d: Date;
  try {
    d = input instanceof Date ? input : new Date(input);
  } catch {
    return '';
  }
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return '';

  const diffMin = Math.floor((now - ms) / 60000);
  // 未来时间(时钟偏差 / 服务端时区问题)不显示成「-3 分钟前」
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小时前`;
  return opts.withTime
    ? d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
