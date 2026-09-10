/**
 * 统计数字的三态显示(v12.432)。
 *
 * 修前 dashboard 的 metrics 初值是全 0,接口 `.catch(() => {})` 一吞,
 * 页面就稳稳显示「0 个项目 / 0 次生成 / 0 个案例」,旁边「系统在线」的绿点照闪 ——
 * 和「这个账号真的什么都没有」在界面上完全无法区分,用户会以为数据丢了。
 *
 * 0 是一个**结论**,只有真读到才配写出来。没读到就得是破折号 + 一句人话。
 */
export type MetricState = 'loading' | 'ok' | 'failed';

/** 读到了才给数字;没读到给破折号,绝不用 0 冒充。 */
export function formatMetric(state: MetricState, value: number): string {
  return state === 'ok' ? String(value) : '—';
}

/** 副标题:破折号旁边必须说清为什么是破折号。 */
export function metricSubLabel(state: MetricState, label: string): string {
  if (state === 'failed') return '没读到,不是 0';
  if (state === 'loading') return '读取中…';
  return label;
}

/**
 * 列表为空时该说哪句话(v12.432)。
 *
 * 「你还没有创作过」和「你的东西我读不到」必须是两句话。说成同一句,
 * 用户看到的就是自己的作品凭空消失,还被引导去「创建第一个项目」。
 *
 * 和 formatMetric 共用 MetricState:同一个页面里数字和列表得口径一致 ——
 * 修了 metrics 却把同一文件的 generations 留在老写法上,是这一族 bug 最常见的复发方式。
 */
export function emptyStateLabel(state: MetricState, emptyText: string): string {
  if (state === 'failed') return '没读到 —— 加载失败,刷新页面重试';
  if (state === 'loading') return '读取中…';
  return emptyText;
}
