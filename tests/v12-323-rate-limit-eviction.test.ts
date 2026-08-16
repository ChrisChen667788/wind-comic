/**
 * v12.323 — 限流桶表只增不减:**防滥用的组件自己成了滥用入口**。
 *
 * ── 病象 ──────────────────────────────────────────────────────────
 * `lib/rate-limit.ts` 的 `buckets` Map 从来不回收(只有测试用的 `clear()`)。
 * 而 key 里含**攻击者完全可控的无界字段**:
 *   `login:<ip>:<email>`   ← email 来自请求体
 * POST 一百万个不同邮箱,就在进程里种下一百万个永不过期回收的桶。
 * 讽刺的是 v12.239 刚把同一个函数针对 XFF 伪造加固过(绕过 + 反向 DoS 两面),
 * 却把无界 key 空间留在了原地。
 *
 * ── 为什么不用 setInterval ────────────────────────────────────────
 * 定时器会吊住事件循环、在 serverless 上没有稳定归宿,还让单测被迫依赖真实时间。
 * 改成**写入时摊还清扫**:纯函数、`now` 可注入、热路径零成本。
 *
 * ── 这次修复真正的难点 ────────────────────────────────────────────
 * 淘汰会**释放**别人的封禁。若按「最早插入」淘汰,攻击者只要用垃圾 key 把表刷满,
 * 就能把自己那条已经打满的封禁桶挤掉,换回干净窗口 —— 等于给他一个洗白开关。
 * 所以顺序必须是:已过期 → 未达上限 → **正在封禁的最后才动**。
 * 下面第三个 describe 专门锁这条;它比「不再无限增长」更容易写错。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, _resetRateLimits, _rateLimitStats } from '@/lib/rate-limit';

const OPTS = { limit: 3, windowMs: 60_000 };

beforeEach(() => _resetRateLimits());

describe('v12.323 · 原有行为一字未改', () => {
  it('窗口内计数、到上限后拒绝、给出重试秒数', () => {
    const t = 1_000_000;
    expect(rateLimit('k', OPTS, t)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rateLimit('k', OPTS, t + 1)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateLimit('k', OPTS, t + 2)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = rateLimit('k', OPTS, t + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('窗口过后自动开新窗口', () => {
    const t = 2_000_000;
    rateLimit('k', OPTS, t); rateLimit('k', OPTS, t); rateLimit('k', OPTS, t);
    expect(rateLimit('k', OPTS, t + 1).allowed).toBe(false);
    expect(rateLimit('k', OPTS, t + OPTS.windowMs).allowed, '新窗口应放行').toBe(true);
  });
});

describe('v12.323 · 表不再无限增长', () => {
  it('**一万个一次性 key 之后,桶数不超过上限**(原先是线性膨胀)', () => {
    const t = 3_000_000;
    for (let i = 0; i < 12_000; i++) rateLimit(`login:direct:user${i}@x.com`, OPTS, t);
    const { size, max } = _rateLimitStats();
    expect(size, `桶数 ${size} 超过上限 ${max}`).toBeLessThanOrEqual(max);
  });

  it('过期的桶会被清掉,而不是靠淘汰硬挤', () => {
    const t = 4_000_000;
    for (let i = 0; i < 600; i++) rateLimit(`a${i}`, OPTS, t);
    const before = _rateLimitStats().size;
    expect(before).toBeGreaterThan(100);
    // 时间推过窗口后再写入,触发摊还清扫
    const later = t + OPTS.windowMs + 1;
    for (let i = 0; i < 300; i++) rateLimit(`b${i}`, OPTS, later);
    expect(_rateLimitStats().size, '过期桶应被回收').toBeLessThan(before + 300);
  });

  it('清扫不会误伤仍在窗口内的桶', () => {
    const t = 5_000_000;
    rateLimit('keep', OPTS, t);
    rateLimit('keep', OPTS, t);        // count=2
    for (let i = 0; i < 400; i++) rateLimit(`junk${i}`, OPTS, t);
    // 'keep' 仍应保有计数(第三次才到上限)
    expect(rateLimit('keep', OPTS, t).remaining, 'keep 的计数被清掉了').toBe(0);
  });
});

describe('v12.323 · **攻击者不能靠刷表洗掉自己的封禁**(本版关键)', () => {
  it('表被垃圾 key 挤满后,已封禁的 key 仍然被封', () => {
    const t = 6_000_000;
    const victimKey = 'login:direct:attacker@x.com';
    // 打满 → 进入封禁
    for (let i = 0; i < OPTS.limit; i++) rateLimit(victimKey, OPTS, t);
    expect(rateLimit(victimKey, OPTS, t).allowed, '前置条件:应已封禁').toBe(false);

    // 用远超上限的垃圾 key 猛刷,试图把自己的封禁桶挤出去
    for (let i = 0; i < 15_000; i++) rateLimit(`junk:${i}`, OPTS, t);

    expect(
      rateLimit(victimKey, OPTS, t).allowed,
      '封禁被刷表冲掉了 —— 攻击者获得了「洗白开关」',
    ).toBe(false);
  });

  it('淘汰优先挑未达上限的桶(丢了只损失一点计数,不放走任何封禁)', () => {
    const t = 7_000_000;
    const blocked = 'blocked-key';
    for (let i = 0; i < OPTS.limit; i++) rateLimit(blocked, OPTS, t);
    // 全部同一时刻创建,窗口相同 → 淘汰只能靠「档位」区分
    for (let i = 0; i < 15_000; i++) rateLimit(`fresh:${i}`, OPTS, t);
    expect(rateLimit(blocked, OPTS, t).allowed).toBe(false);
  });
});

describe('v12.323 · 实现上的取舍写在代码里(不靠人记)', () => {
  const raw = require('node:fs').readFileSync('lib/rate-limit.ts', 'utf-8') as string;
  // 断言「代码里没有定时器」必须剥掉注释 —— 注释里正解释着为什么不用 setInterval,
  // 直接扫原文会命中自己的说明文字(这轮第三次栽在这上面)。
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('不用定时器 —— setInterval 会吊住事件循环', () => {
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });

  it('热路径不付回收成本(只在新建桶时清扫/淘汰)', () => {
    expect(src).toMatch(/if \(!b\) \{/);
    expect(src).toMatch(/writeCount % SWEEP_EVERY/);
  });

  it('代码里写明了「封禁桶最后才淘汰」的理由(这条读原文,理由本就在注释里)', () => {
    expect(raw).toMatch(/正在封禁/);
    expect(raw).toMatch(/洗白|挤掉/);
  });
});
