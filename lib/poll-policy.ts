/**
 * lib/poll-policy — 轮询时**该重试还是该立刻放弃**的唯一判定。v12.329。
 *
 * ── 病象:同一语义七套实现,两种相反的错法 ────────────────────────
 * 各引擎都要轮询「任务好了没」,但对**非 200 响应**的处理彼此矛盾:
 *
 *   · Keling / Vidu —— 任何非 200 直接 `throw`。于是轮询中间来一次瞬时 429 / 502,
 *     就把**上游其实还在跑、马上要出片**的任务整个丢掉。**钱已经花了,结果扔了。**
 *   · HappyHorse —— 任何非 200 一律 `continue`(注释写着「瞬时错误不打断轮询」)。
 *     于是 401(key 失效)、404(任务不存在)这类**永远不会好**的情况,也要把
 *     整个超时白等满 —— 本可立刻给出的报错,拖到十分钟后才说。
 *
 * 两种都错,而且错在同一处:**没区分「等一下会好」和「等到天荒地老也不会好」**。
 *
 * ── 判定 ──────────────────────────────────────────────────────────
 * terminal(立刻停):400 / 401 / 403 / 404 / 410 —— 请求本身有问题或对象没了,
 *   再轮一万次也是同一个答案,继续轮只是把坏消息延后。
 * transient(继续轮):408 / 425 / 429 / 5xx、以及网络层异常 —— 上游忙或抖了一下,
 *   任务多半还在跑,这时候放弃才是真的浪费。
 * 其余非 2xx 一律按 transient 处理:**宁可多等,不可错杀已经付过钱的任务。**
 */

export type PollDisposition = 'ok' | 'transient' | 'terminal';

/** 明确「再试也没用」的状态码。 */
const TERMINAL = new Set([400, 401, 403, 404, 410]);
/** 明确「值得再试」的状态码(5xx 走区间判断,不在此列)。 */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

export function classifyPollStatus(status: number): PollDisposition {
  if (status >= 200 && status < 300) return 'ok';
  if (TERMINAL.has(status)) return 'terminal';
  if (TRANSIENT.has(status) || status >= 500) return 'transient';
  // 其余(如 402 余额不足、409 冲突)：保守按可重试处理，由次数上限兜底。
  // 取舍写明:错杀一个上游已在生成的任务 = 白烧一次钱;多轮几次 = 多等几秒。
  return 'transient';
}

/** 给 terminal 情形的人话错误信息 —— 让人一眼知道该去改什么,而不是「轮询失败」。 */
export function terminalPollMessage(engine: string, status: number): string {
  switch (status) {
    case 401:
    case 403:
      return `${engine} 拒绝了这次查询(HTTP ${status})—— key 无效或没有该任务的权限,继续轮询不会变好`;
    case 404:
    case 410:
      return `${engine} 说这个任务不存在或已过期(HTTP ${status})—— 多半是任务 id 失效,继续轮询不会变好`;
    default:
      return `${engine} 认为查询请求本身有问题(HTTP ${status})—— 继续轮询不会变好`;
  }
}
