/**
 * 进程内滑动窗口限流(per-process)。
 *
 * 用途:挡暴力撞库 / 注册刷量等高频滥用。单实例部署足够;多实例需换 Redis 等
 * 共享存储(本模块刻意保持纯内存、零依赖,便于单测与本地运行)。
 *
 * 设计:
 *   - `rateLimit(key, opts, now?)` 是纯函数式接口(可注入 `now`)→ 直接单测。
 *   - 桶按 key 存:首次命中开一个 `windowMs` 窗口,窗口内累计;到点自动重置。
 *   - 路由层用 `isRateLimitActive()` 跳过测试环境(避免 route 级测试被限流误伤;
 *     限流逻辑本身由本文件的单测覆盖)。
 */

export interface RateLimitResult {
  /** 是否放行 */
  allowed: boolean;
  /** 本窗口剩余可用次数 */
  remaining: number;
  /** 被限时建议的重试等待秒数(allowed=true 时为 0) */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const b = buckets.get(key);
  // 无桶 或 窗口已过 → 开新窗口
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: Math.max(0, opts.limit - 1), retryAfterSec: 0 };
  }
  // 窗口内已达上限 → 拒绝
  if (b.count >= opts.limit) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  // 窗口内未达上限 → 计数 + 放行
  b.count += 1;
  return { allowed: true, remaining: Math.max(0, opts.limit - b.count), retryAfterSec: 0 };
}

/** 提取客户端 IP:取 `x-forwarded-for` 首段,降级 `x-real-ip`,再降级 `'unknown'`。 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0].trim();
  const xr = request.headers.get('x-real-ip');
  return (xr && xr.trim()) || 'unknown';
}

/** 路由层是否启用限流:测试环境(vitest)关闭,避免 route 级测试被限流误伤。 */
export function isRateLimitActive(): boolean {
  return !(process.env.VITEST || process.env.NODE_ENV === 'test');
}

/** 测试辅助:清空所有桶。 */
export function _resetRateLimits(): void {
  buckets.clear();
}
