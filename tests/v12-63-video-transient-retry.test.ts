/**
 * v12.63 — 视频瞬时错误同 provider 重试:isTransientVideoError 判定 + dispatch 重试行为。
 */
import { describe, it, expect } from 'vitest';
import { isTransientVideoError } from '@/lib/video-providers/registry';

describe('v12.63 · isTransientVideoError', () => {
  it('引擎偶发生成失败/超时/网络/5xx → 瞬时(重试)', () => {
    for (const m of [
      'Minimax video-01 error',
      'Minimax-Fast error',
      'fetch failed',
      'Request timeout after 30000ms',
      'ECONNRESET',
      'HTTP 500 internal error',
      'Veo API error (502): bad gateway',
    ]) expect(isTransientVideoError(m), m).toBe(true);
  });

  it('鉴权/额度/限流/参数/审核/无通道 → 非瞬时(不重试)', () => {
    for (const m of [
      'HTTP 401: Invalid token',
      'HTTP 402 Payment Required',
      'HTTP 429 rate limited',
      'Minimax账户余额不足',
      "model S2V-01 and param 'first_frame_image' are mutually exclusive",
      'Veo API error (503): No available channel for model veo_3_1_vip',
      'Current group upstream load is saturated, please try again later',
      'content policy violation: sensitive',
    ]) expect(isTransientVideoError(m), m).toBe(false);
  });

  it('空/无关消息 → 非瞬时', () => {
    expect(isTransientVideoError('')).toBe(false);
    expect(isTransientVideoError('some random failure')).toBe(false);
  });
});
