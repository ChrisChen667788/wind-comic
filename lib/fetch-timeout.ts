/**
 * lib/fetch-timeout — 带超时的出站请求(纯工具,零依赖)。
 *
 * v12.304 抽出。此前 `veo.service.ts` 与 `minimax.service.ts` **各有一份一字不差的复制**,
 * 而 `keling.service.ts` / `happyhorse.service.ts` 干脆用裸 `fetch` —— 没有任何超时。
 *
 * 裸 fetch 的后果不是「慢一点」:网关**接受 TCP 连接但不返回 HTTP 响应**时,
 * `await fetch(...)` 会一直挂到 OS socket 超时(通常数分钟)。轮询循环因此卡在第一次迭代,
 * `maxAttempts × interval` 那套「10 分钟上限」形同虚设 —— 单个视频槽可占用数十分钟,
 * 拖累同实例的其它任务。
 *
 * 与两份旧实现的差异:超时被 abort 时抛的是 `AbortError`(文案 "This operation was aborted"),
 * 排查时完全看不出是**谁**超时、等了多久。这里换成可读错误,并保留 `cause`。
 */

export class FetchTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number, cause?: unknown) {
    super(`请求超时(${timeoutMs}ms 未响应):${url}`);
    this.name = 'FetchTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
    if (cause !== undefined) (this as any).cause = cause;
  }
}

/**
 * @param timeoutMs 默认 30s(沿用两份旧实现的默认值,避免改变既有调用方的行为)
 *
 * 调用方已传 `signal` 时**两者都生效**:任一触发即中止(用户取消 / 超时)。
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  // 调用方自带的 signal 不能被丢掉 —— 旧实现直接 `signal: controller.signal` 覆盖了它
  const external = init.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(url, { ...init, signal: controller.signal })
    .catch((e) => {
      // 只有「本次超时」才换成可读错误;外部取消要如实反映为取消
      if (timedOut && !external?.aborted) throw new FetchTimeoutError(url, timeoutMs, e);
      throw e;
    })
    .finally(() => clearTimeout(timer));
}
