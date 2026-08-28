/**
 * v12.348:两个「系统知道、但没说」的引擎问题 —— 都是实测重跑素材时撞出来的。
 *
 * ① 显式指定 `happyhorse` 被静默忽略。
 *    v12.272 接入了 HappyHorse,主管线会把它 push 进 availableEngines,
 *    **但单镜重生那条路径的 availForRegen 只列了 veo/minimax/kling** ——
 *    于是 `resolveEngineOrder('happyhorse', ...)` 里 `has()` 为假,显式选择被丢掉,
 *    回落到 env 链序(可灵打头)。日志还一直打着「HappyHorse: ON」。
 *    两条路不对称,而不对称的那条没人看。
 *
 * ② 可灵欠费被记成「限流」,巡检一路报 OK。
 *    可灵欠费原文是 "Account balance not enough"(HTTP 429),而运行时词表只认
 *    credit/余额/insufficient —— 三个词一个不沾,落到兜底的 rate_limited。
 *    巡检那份词表**本来是全的**(认 balance / not enough),但两边各写一套,
 *    好的那份没被复用。后果:「限流→等一会」vs「欠费→充值」,建议完全相反。
 *    owner 的可灵从 2026-08-11 起没钱,告警 ×18 次,17 天没被看出来。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ARREARS_RE, SATURATED_RE, looksLikeArrears } from '@/lib/quota-vocab.mjs';
import { detectQuotaError } from '@/lib/api-usage-tracker';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.348 欠费措辞词表(全仓唯一一份)', () => {
  it.each([
    ['Kling API error (429): {"code":1102,"message":"Account balance not enough"}', true, '可灵欠费(旧词表漏掉的那条)'],
    ['已达到 Token Plan 用量上限:请升级 Token Plan 套餐或购买积分补充用量。', true, 'MiniMax 额度耗尽'],
    ['Token quota exhausted', true, '青云top(HTTP 401 却是欠费)'],
    ['insufficient_quota', true, 'OpenAI'],
    ['Rate limit exceeded, please retry later', false, '真限流不该算欠费'],
    ['pre_consume_token_quota_failed', false, '上游饱和是排队问题不是钱的问题'],
  ])('%s → 欠费=%s(%s)', (msg, want) => {
    expect(ARREARS_RE.test(msg)).toBe(want);
  });

  it('饱和词表不吞欠费(两者处置不同:换引擎 vs 充值)', () => {
    expect(SATURATED_RE.test('Account balance not enough')).toBe(false);
  });

  it('402 一律算欠费,不看报文', () => {
    expect(looksLikeArrears(402, '')).toBe(true);
  });
});

describe('v12.348 运行时分类接入共享词表', () => {
  it('可灵 1102 判为 exhausted 而不是 rate_limited', () => {
    const t = detectQuotaError('kling' as never, 429,
      'Kling API error (429): {"code":1102,"message":"Account balance not enough"}');
    expect(t).toBe('exhausted');
  });

  it('可灵真限流仍判 rate_limited(没把限流一并吞掉)', () => {
    expect(detectQuotaError('kling' as never, 429, 'rate limit, too many requests')).toBe('rate_limited');
  });

  it('欠费规则必须排在 rate_limited 之前 —— 欠费返回的就是 429', () => {
    const src = read('lib/api-usage-tracker.ts');
    const kling = src.slice(src.indexOf('  kling: ['), src.indexOf('  vidu: ['));
    expect(kling.indexOf("'exhausted'")).toBeLessThan(kling.indexOf("'rate_limited'"));
  });

  it('运行时不再自带一份措辞词表(收口到 quota-vocab)', () => {
    const src = read('lib/api-usage-tracker.ts');
    expect(src).toMatch(/from '\.\/quota-vocab\.mjs'/);
    // kling/vidu/fal 的 exhausted 都改用共享词表
    expect(src).not.toMatch(/exhausted', match: \(sc, msg\) => \/credit\|余额\|insufficient\//);
  });
});

describe('v12.348 巡检不再谎报 OK', () => {
  const audit = read('scripts/api-health-audit.mjs');

  it('可灵探测如实标为「仅鉴权」—— 查任务接口看不到余额', () => {
    expect(audit).toMatch(/'仅鉴权'/);
    expect(audit).toMatch(/余额未验/);
  });

  it('巡检读运行时告警表(系统早就知道,只是没告诉巡检)', () => {
    expect(audit).toMatch(/api_quota_alerts/);
    expect(audit).toMatch(/loadRuntimeAlerts/);
  });

  it('**不信存下来的 alert_type** —— 历史行正是被错分的,直接判原文', () => {
    expect(audit).toMatch(/ARREARS_RE\.test\(String\(a\.error_message/);
  });

  it('「仅鉴权」要进「需处理」,不能混在 OK 里蒙混过去', () => {
    expect(audit).toMatch(/r\.verdict === '仅鉴权'/);
  });

  it('拿不到本地库不该让巡检失败(CI / 别人的机器)', () => {
    expect(audit).toMatch(/catch \{ return \[\]; \}/);
  });
});

describe('v12.348 单镜重生补齐 happyhorse', () => {
  const orch = read('services/hybrid-orchestrator.ts');
  const win = orch.slice(orch.indexOf('const availForRegen'), orch.indexOf('const genByEngine'));

  it('availForRegen 含 happyhorse', () => {
    expect(win).toMatch(/happyhorse/);
  });

  it('且沿用主管线同一条画幅支持判断,不是随手加进去', () => {
    expect(win).toMatch(/happyHorseAspectSupported\(this\.videoAspect\(\)\)/);
  });

  it('显式指定了不可用的引擎要**出声**,不能静默换一个跑', () => {
    expect(win).toMatch(/console\.warn/);
    expect(win).toMatch(/已回落到链序/);
  });

  it('genByEngine 有 happyhorse 实现(光进候选表不够)', () => {
    const gen = orch.slice(orch.indexOf('const genByEngine'), orch.indexOf('const genByEngine') + 1600);
    expect(gen).toMatch(/happyhorse: \(\) =>/);
    expect(gen).toMatch(/this\.happyhorseService!\.generateVideo/);
  });
});
