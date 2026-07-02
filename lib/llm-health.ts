/**
 * LLM 模型健康缓存(P0-2,v12.61.0)。
 *
 * 病根:qingyuntop 网关某模型 429/503 饱和时,一条片子几十次 LLM 调用**每次都先白撞**那个饱和模型
 * (1-10s/次)再落兜底 —— 实测今天 opus/sonnet 轮流饱和,整片被拖到几小时。缓存:某 (base|model)
 * 429/503/超时后**冷却期内跳过**,直接用链上下一个健康模型;冷却到期自动恢复。跨调用共享,进程级。
 *
 * 纯逻辑(注入 now 可测)。「全 down」时不返回空 —— 保留原链最后一个作最后一搏(宁可慢也别不生成)。
 */

const downUntil = new Map<string, number>();
const DEFAULT_TTL_MS = 90_000; // 429 饱和通常一两分钟缓解;超时/5xx 同档冷却

export function llmKey(a: { baseURL?: string; model?: string }): string {
  return `${a.baseURL || ''}|${a.model || ''}`;
}

/** 标记某模型端点在 ttl 内不可用(429/503/超时后调用)。 */
export function markLLMDown(key: string, ttlMs: number = DEFAULT_TTL_MS, now: number = Date.now()): void {
  downUntil.set(key, now + Math.max(1000, ttlMs));
}

/** 当前是否冷却中(到期自动清)。 */
export function isLLMDown(key: string, now: number = Date.now()): boolean {
  const t = downUntil.get(key);
  if (t == null) return false;
  if (t <= now) { downUntil.delete(key); return false; }
  return true;
}

/** 过滤掉冷却中的尝试;绝不返回空(全 down → 保留原链最后一个,最后一搏)。纯逻辑,注入 now。 */
export function filterHealthyAttempts<T extends { baseURL?: string; model?: string }>(
  attempts: T[],
  now: number = Date.now(),
): T[] {
  if (attempts.length <= 1) return attempts;
  const healthy = attempts.filter((a) => !isLLMDown(llmKey(a), now));
  return healthy.length > 0 ? healthy : [attempts[attempts.length - 1]];
}

/** 测试用:清空健康缓存。 */
export function _resetLLMHealth(): void {
  downUntil.clear();
}
