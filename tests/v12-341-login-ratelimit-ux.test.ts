/**
 * v12.341 — 登录被限流时,如实说清楚。
 *
 * ## 真事驱动的一版
 * owner 真机测试时登录失败,以为密码记错了。查下来:密码**完全正确**(bcrypt 哈希匹配),
 * 是防爆破限流把他锁了 —— 服务端返回 **429 + Retry-After: 546**,而界面把 429 和 401
 * 显示成同一句「操作失败」。于是他对着一句含糊的报错反复重试,而系统其实一直知道
 * 「还剩 9 分钟」却没说。
 *
 * ## 断链在哪
 * `lib/api-client.ts` 的 request() 保留了 status,却**丢掉了 Retry-After 头** ——
 * 服务端算好的秒数传不到界面。三处一起修:带出头、识别 429、冷却期禁用提交并倒计时。
 *
 * ## 一处我先说错、查代码后更正的
 * 我最初告诉 owner「每重试一次都在延长锁定」。读 lib/rate-limit 后确认**不是**:
 * `count >= limit` 时直接返回、不再累加,而 resetAt 是建桶时一次性定的固定窗口。
 * 所以锁定期内重试既不会延长、也不会缩短它 —— 文案必须按这个事实写,不能吓唬人。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { rateLimit } from '@/lib/rate-limit';

const CLIENT = fs.readFileSync('lib/api-client.ts', 'utf-8');
const PAGE = fs.readFileSync('app/auth/page.tsx', 'utf-8');
const ROUTE = fs.readFileSync('app/api/auth/login/route.ts', 'utf-8');

describe('v12.341 · 前提:服务端确实给了 Retry-After', () => {
  it('登录路由 429 时带 Retry-After 头', () => {
    expect(ROUTE).toMatch(/'Retry-After': String\(retry\)/);
    expect(ROUTE).toMatch(/status: 429/);
  });
});

describe('v12.341 · 锁定期内重试**不会延长**锁(我先说错、查代码更正的那条)', () => {
  it('达到上限后继续打,retryAfterSec 只减不增', () => {
    const key = `t-${Math.random()}`;
    const opts = { limit: 3, windowMs: 60_000 };
    let now = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit(key, opts, now);      // 打满
    const first = rateLimit(key, opts, now + 1_000);
    const later = rateLimit(key, opts, now + 30_000);           // 锁定期内又试了一次
    expect(first.allowed).toBe(false);
    expect(later.allowed).toBe(false);
    expect(later.retryAfterSec, '重试若延长锁定,这个数会不减反增').toBeLessThan(first.retryAfterSec);
  });

  it('窗口过后自动放行(锁不是永久的)', () => {
    const key = `t2-${Math.random()}`;
    const opts = { limit: 2, windowMs: 60_000 };
    let now = 2_000_000;
    rateLimit(key, opts, now); rateLimit(key, opts, now);
    expect(rateLimit(key, opts, now + 1_000).allowed).toBe(false);
    expect(rateLimit(key, opts, now + 61_000).allowed, '窗口过后该放行').toBe(true);
  });
});

describe('v12.341 · Retry-After 一路传到界面', () => {
  it('api-client 把 Retry-After 挂到 error 上(此前只留 status)', () => {
    const i = CLIENT.indexOf('if (!res.ok)');
    const block = CLIENT.slice(i, i + 700);
    expect(block).toContain("res.headers.get('Retry-After')");
    expect(block).toContain('retryAfterSec');
    expect(block, '非数字/非正数不该写进去').toMatch(/Number\.isFinite\(sec\) && sec > 0/);
  });

  it('登录页按 429 / 401 分开说,不再一句「操作失败」通吃', () => {
    expect(PAGE).toMatch(/err\?\.status === 429/);
    expect(PAGE).toMatch(/err\?\.status === 401/);
    expect(PAGE, '401 要说密码不对').toContain('邮箱或密码不正确');
    expect(PAGE, '429 要说是频繁而非密码错').toMatch(/登录尝试过于频繁/);
  });

  it('**明确告诉用户密码可能是对的** —— 这正是当时误判的根源', () => {
    const i = PAGE.indexOf('err?.status === 429');
    expect(PAGE.slice(i, i + 600)).toMatch(/密码可能是对的/);
  });
});

describe('v12.341 · 冷却期的交互', () => {
  it('秒数格式化成人能读的(540 秒 → 9 分钟)', () => {
    expect(PAGE).toContain('function fmtWait');
    const i = PAGE.indexOf('function fmtWait');
    const fn = PAGE.slice(i, i + 300);
    expect(fn).toMatch(/分/);
    expect(fn).toMatch(/秒/);
  });

  it('冷却期内禁用提交按钮,并显示倒计时', () => {
    expect(PAGE).toMatch(/disabled=\{loading \|\| cooldownSec > 0\}/);
    expect(PAGE).toMatch(/cooldownSec > 0[\s\S]{0,80}fmtWait\(cooldownSec\)/);
  });

  it('**只禁按钮、不禁输入框** —— 用户可以趁等待把密码改对', () => {
    expect(PAGE, '输入框不该被冷却状态禁用').not.toMatch(/<input[^>]*disabled=\{[^}]*cooldownSec/);
  });

  it('倒计时每秒递减且会自行停止(不留 interval)', () => {
    const i = PAGE.indexOf('useEffect(() => {');
    const eff = PAGE.slice(i, i + 400);
    expect(eff).toMatch(/setInterval/);
    expect(eff, '必须清理定时器').toMatch(/clearInterval/);
    expect(eff, '归零后不再继续').toMatch(/n > 1 \? n - 1 : 0/);
  });

  it('冷却说明对读屏可见,且不吓唬人(重试不会延长锁)', () => {
    expect(PAGE).toMatch(/role="status"/);
    expect(PAGE).toMatch(/不会延长/);
    expect(PAGE, '错误提示也该是 alert').toMatch(/role="alert"/);
  });
});
