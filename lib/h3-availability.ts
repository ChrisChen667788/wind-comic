/**
 * lib/h3-availability — 进程内记住「这把 key 用不了 H3」。v12.448。
 *
 * v12.402 起每一镜都先打一次 H3,报「套餐不支持」再回落 legacy(v12.446 修好了回落)。
 * 在 Token Plan 账号上,这等于每镜白发一次必败请求、刷一条告警 —— 一个 30 镜的项目就是 30 次。
 * 参考视频(v12.448)只能走 H3,同样会每镜撞一次。
 *
 * 所以第一次确认「套餐不支持」后记一段时间(默认 30 分钟),期间直接走回落,只在记下那一刻告警一次。
 * **只记「套餐不支持」这一种** —— 网络抖动、额度用尽、参数错误都不记:那些换个时间或换个参数就可能成,
 * 记下来反而会把能用的 H3 屏蔽掉。换成按量付费的 key 后最迟 30 分钟自动恢复(重启进程立刻恢复)。
 */
const TTL_MS = Math.max(60_000, Number(process.env.MINIMAX_H3_UNAVAILABLE_TTL_MS) || 30 * 60_000);

let unavailableUntil = 0;
let lastReason = '';

/** 记下「H3 不可用」。返回 true 表示这是新记下的(调用方据此只告警一次) */
export function markH3Unavailable(reason: string, now = Date.now()): boolean {
  const fresh = now >= unavailableUntil;
  unavailableUntil = now + TTL_MS;
  lastReason = reason.slice(0, 200);
  return fresh;
}

/** 当前是否已知 H3 不可用(过期即视为未知,会再试一次) */
export function isH3KnownUnavailable(now = Date.now()): boolean {
  return now < unavailableUntil;
}

export function h3UnavailableReason(): string {
  return lastReason;
}

/** 测试用;生产里换 key 需要重启进程,不走这里 */
export function resetH3Availability(): void {
  unavailableUntil = 0;
  lastReason = '';
}
