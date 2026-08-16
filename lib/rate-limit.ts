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

/**
 * v12.323:桶表**必须有上限**。
 *
 * 原先 `buckets` 只增不减 —— 而 key 里含**攻击者可控的无界字段**:
 * `login:<ip>:<email>` 的 email 是请求体里随便填的。POST 一百万个不同邮箱,
 * 就在被限流的进程里种下一百万个永不回收的桶。**用来防滥用的限流器,
 * 自己成了内存耗尽的入口**(v12.239 刚把这个函数加固过 XFF 伪造,
 * 却把无界 key 空间留在了原地)。
 *
 * 不用定时器:`setInterval` 会吊住事件循环、在 serverless 上没有稳定归宿,
 * 还让单测被迫依赖真实时间。改为**写入时摊还清扫**,纯函数、`now` 可注入。
 */
const MAX_BUCKETS = 10_000;
/** 每写入这么多次做一次过期清扫(摊还成本 O(1)) */
const SWEEP_EVERY = 256;
let writeCount = 0;

/** 清掉所有已过期的桶。返回清掉的数量。 */
function sweepExpired(now: number): number {
  let n = 0;
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) { buckets.delete(k); n++; }
  }
  return n;
}

/**
 * 表满时的淘汰:**正在封禁中的桶最后才动**。
 *
 * 这一条是这次修复的关键。若按「最早插入」之类的顺序淘汰,攻击者只要用垃圾 key
 * 把表刷满,就能把**自己那条已经打满的封禁桶**挤掉,换回一个干净窗口 ——
 * 那等于给了他一个「花钱洗白」的开关,限流形同虚设。
 * 所以顺序是:① 已过期 → ② 未达上限(还能放行,丢了只损失一点计数)
 * → ③ 正在封禁(万不得已才丢),同档内先丢最接近到期的(剩余价值最小)。
 */
function evictOne(limitOf: number): void {
  let victim: string | null = null;
  let best: [number, number] = [Infinity, Infinity];   // [档位, resetAt] 取最小
  for (const [k, v] of buckets) {
    const rank = v.count >= limitOf ? 1 : 0;
    if (rank < best[0] || (rank === best[0] && v.resetAt < best[1])) {
      victim = k; best = [rank, v.resetAt];
    }
  }
  if (victim !== null) buckets.delete(victim);
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const b = buckets.get(key);
  // 无桶 或 窗口已过 → 开新窗口
  if (!b || now >= b.resetAt) {
    // v12.323:只在**新建桶**时付回收成本 —— 命中已有桶的热路径一分钱不花。
    if (!b) {
      if (++writeCount % SWEEP_EVERY === 0) sweepExpired(now);
      if (buckets.size >= MAX_BUCKETS) {
        // 先清过期(通常够了),仍满才淘汰一个
        if (sweepExpired(now) === 0) evictOne(opts.limit);
      }
    }
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

/**
 * 提取客户端 IP。
 *
 * v12.239(第五轮对抗复检):此前**无条件**取 `x-forwarded-for` 首段 —— 而那是攻击者
 * 完全可控的请求头。后果有两面:①**绕过**:登录爆破每次换一个伪造 IP,
 * `login:<ip>:<email>` 的 10 次/窗口 形同虚设;②**反向 DoS**:把受害者真实 IP 填进 XFF,
 * 就能把别人的限流桶打满,让其无法登录。
 *
 * 现在:只有在运维**显式声明**「本服务部署在受信代理之后」时才采信这些头
 * (`TRUST_PROXY_HEADERS=1`)。默认不信 —— 无代理直连时,伪造头不再能影响任何人的桶。
 * 注:Node 层拿不到 socket 远端地址(Next 的 Request 不暴露),所以默认退化为
 * 全体共用 'unknown' 桶。这对「单机直连」是**更严**而非更松:所有人共享配额、伪造无收益。
 */
export function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== '1') return 'direct';
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
  writeCount = 0;
}

/** 测试/可观测:当前桶数量与上限(用于断言回收确实发生,而不是「看起来没崩」)。 */
export function _rateLimitStats(): { size: number; max: number } {
  return { size: buckets.size, max: MAX_BUCKETS };
}
