/**
 * lib/provider-health-cache (v12.8.0 · 阶段二十三 G6) — provider 软熔断(进程内内存缓存)。
 *
 * 问题:某引擎连续 auth_error / 配额耗尽 / 上游池饱和(503)时,selectProviders / 视频引擎循环
 * 仍会一次次选中它反复打 → 慢 + 浪费 + 整批失败。
 * 方案:失败时把该 provider 标「冷却 N 秒」,期间从候选里跳过;TTL 过期或探针通过自动恢复。
 * 全同步读(isProviderHealthy 不可异步,否则拖慢每次 dispatch)。进程内即可 —— 单实例足够,
 * 多实例各自熔断也无害(各自避开自己打爆的 key)。
 */

interface HealthEntry {
  downUntil: number; // epoch ms,过此时刻自动恢复
  reason: string;
}

const cache = new Map<string, HealthEntry>();

/** 默认冷却时长(ms)。安全红线:不得低于 60s,防高并发下熔断/恢复震荡。 */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const MIN_COOLDOWN_MS = 60 * 1000;

/** 标记某 provider 冷却。ttlMs 会被夹到 ≥ 60s。 */
export function markProviderDown(id: string, ttlMs: number = DEFAULT_COOLDOWN_MS, reason = 'failure'): void {
  if (!id) return;
  const ttl = Math.max(MIN_COOLDOWN_MS, ttlMs);
  cache.set(id, { downUntil: Date.now() + ttl, reason });
}

/** 同步查健康。无记录 = 健康;TTL 过期自动清并恢复。 */
export function isProviderHealthy(id: string): boolean {
  const e = cache.get(id);
  if (!e) return true;
  if (Date.now() >= e.downUntil) { cache.delete(id); return true; }
  return false;
}

/** 探针/成功调用后显式恢复。 */
export function markProviderHealthy(id: string): void {
  cache.delete(id);
}

/**
 * 按错误文本判定是否「致命到该熔断」,是则标冷却并返回 true。
 * - auth/401/403/key 无效 → 5min(配置问题,短期重试无意义)
 * - 配额/余额耗尽 / 池饱和 / 分组饱和 → 5min
 * - rate-limit / 429 → 1min(瞬时,短冷却)
 * - 其余(超时/网络抖动/未知)→ 不熔断(可能下次就好)
 */
export function markProviderDownIfFatal(id: string, errMsg: string): boolean {
  const m = (errMsg || '').toLowerCase();
  if (/(^|[^0-9])401([^0-9]|$)|(^|[^0-9])403([^0-9]|$)|unauthorized|auth.?error|invalid.?api.?key|api key|密钥|鉴权/.test(m)) {
    markProviderDown(id, 5 * 60 * 1000, 'auth'); return true;
  }
  if (/quota|exhausted|insufficient|余额不足|配额|pre_consume_token_quota_failed|池.?饱和|分组.?饱和|上游.?饱和|saturat/.test(m)) {
    markProviderDown(id, 5 * 60 * 1000, 'quota/saturated'); return true;
  }
  if (/rate.?limit|429|too many requests|限流/.test(m)) {
    markProviderDown(id, 60 * 1000, 'rate-limit'); return true;
  }
  return false;
}

/** 测试/重置用。 */
export function clearProviderHealth(): void { cache.clear(); }

/** 当前所有冷却中的条目(调试/面板用)。 */
export function listUnhealthy(): Array<{ id: string; downUntil: number; reason: string }> {
  const now = Date.now();
  const out: Array<{ id: string; downUntil: number; reason: string }> = [];
  for (const [id, e] of cache) if (now < e.downUntil) out.push({ id, downUntil: e.downUntil, reason: e.reason });
  return out;
}
