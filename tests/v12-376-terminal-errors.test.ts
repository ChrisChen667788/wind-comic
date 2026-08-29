/**
 * v12.376:界面给了一个「重试」按钮,而那个调用永远不可能成功。
 *
 * 想给项目 1 补一首 BGM,接口回 502「AI 作曲失败:fetch failed
 * (需配置 MiniMax key 且 music-2.6 有额度)」。照这句话查 key、查额度,
 * 一辈子也查不出来 —— 上游给的真话是 HTTP 410 / status_code 2153:
 * 「This Music API is no longer available to new users」,
 * 这个接口对本账号**永久不可用**。
 *
 * 更要命的是分类器:410 含的是 "no longer available",而规则写的是
 * `/not available/`,匹配不上 → 落进 UNKNOWN → retryable 默认 true。
 * 可灵 1102 欠费、MiniMax 2056 当日额度满,同样全落 UNKNOWN、同样 retryable。
 * 而 app/dashboard/create/page.tsx 正是按 retryable 决定要不要给「重试」按钮。
 *
 * 三种「重试绝不会成功」的错误,恰恰是 owner 当下天天遇到的。
 */
import { describe, it, expect } from 'vitest';
import { normalizeError } from '@/lib/pipeline-error';
import { ARREARS_RE, SATURATED_RE, DISCONTINUED_RE, looksLikeArrears } from '@/lib/quota-vocab.mjs';

const MUSIC_410 =
  'Minimax Music API error (410): {"base_resp":{"status_code":2153,"status_msg":"This Music API is no longer available to new users. Existing paying customers can continue to use the service."}}';

describe('终局错误不能标成可重试', () => {
  it('接口已停用(真实 410 报文)→ PROVIDER_DISCONTINUED 且不可重试', () => {
    const e = normalizeError(new Error(MUSIC_410));
    expect(e.code).toBe('PROVIDER_DISCONTINUED');
    expect(e.retryable).toBe(false);
    expect(e.userMsg).not.toMatch(/API Key|额度/);   // 别再把人引向查 key / 查额度
  });

  it('可灵欠费(真实报文)→ PROVIDER_ARREARS 且不可重试', () => {
    const e = normalizeError(new Error('Kling API error: 1102 Account balance not enough'));
    expect(e.code).toBe('PROVIDER_ARREARS');
    expect(e.retryable).toBe(false);
  });

  it('MiniMax 当日额度满 → QUOTA_SATURATED 且不可重试', () => {
    for (const m of ['MiniMax error 2056: rate limit', 'Too Many Requests', '请求过于频繁']) {
      const e = normalizeError(new Error(m));
      expect(e.code, m).toBe('QUOTA_SATURATED');
      expect(e.retryable, m).toBe(false);
    }
  });

  it('欠费判定排在限流之前 —— 可灵欠费走的是 HTTP 429', () => {
    // quota-vocab 的原始教训:按 429 归类会先被限流吃掉,处置就从「充值」错成「等一等」
    const e = normalizeError(new Error('HTTP 429: {"code":1102,"message":"Account balance not enough"}'));
    expect(e.code).toBe('PROVIDER_ARREARS');
  });

  it('「已停用」比欠费更终局,排在最前', () => {
    // 一条同时含两种线索的报文:停用必须赢 —— 充值救不回一个已下线的接口
    const e = normalizeError(new Error('This API is no longer available; your balance is not enough anyway'));
    expect(e.code).toBe('PROVIDER_DISCONTINUED');
  });

  it('真·网络抖动仍然可重试(别把能重试的也堵死)', () => {
    const e = normalizeError(new Error('fetch failed'));
    expect(e.code).toBe('NETWORK');
    expect(e.retryable).toBe(true);
  });

  it('未配 key 仍归 ENGINE_UNAVAILABLE —— 那确实该去查配置', () => {
    expect(normalizeError(new Error('MINIMAX_API_KEY not configured')).code).toBe('ENGINE_UNAVAILABLE');
  });
});

describe('词表收紧:balance 不能裸着用', () => {
  it('图像/视频里的 white balance 不是欠费', () => {
    for (const m of ['Invalid argument for white balance', 'auto white balance failed', 'color balance filter error']) {
      expect(ARREARS_RE.test(m), m).toBe(false);
      expect(normalizeError(new Error(m)).code, m).not.toBe('PROVIDER_ARREARS');
    }
  });

  it('真欠费报文照旧命中(收紧不能误杀)', () => {
    for (const m of [
      'Account balance not enough',
      'insufficient balance',
      '余额不足,请充值',
      'Token quota exhausted',
      '额度已用尽',
      'Token 已用完',
      'account balance is too low',
    ]) {
      expect(ARREARS_RE.test(m), m).toBe(true);
    }
    expect(looksLikeArrears(402, 'whatever')).toBe(true);
  });

  it('「重试次数已用完」不是欠费 —— 通用分类器里什么报文都会经过', () => {
    for (const m of ['重试次数已用完', '尝试次数用尽,放弃本镜', '倒计时用尽']) {
      expect(ARREARS_RE.test(m), m).toBe(false);
      expect(normalizeError(new Error(m)).code, m).not.toBe('PROVIDER_ARREARS');
    }
  });

  it('DISCONTINUED_RE 认得中英两种说法,且不误伤普通「不可用」', () => {
    for (const m of ['no longer available', '该功能已下线', 'API has been deprecated', 'status_code":2153']) {
      expect(DISCONTINUED_RE.test(m), m).toBe(true);
    }
    for (const m of ['engine temporarily unavailable', '服务暂时不可用']) {
      expect(DISCONTINUED_RE.test(m), m).toBe(false);
    }
  });

  it('SATURATED_RE 认得限流,但不把欠费也吃进去', () => {
    expect(SATURATED_RE.test('rate limit exceeded')).toBe(true);
    expect(SATURATED_RE.test('Account balance not enough')).toBe(false);
  });
});
