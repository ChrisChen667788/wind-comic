/**
 * v7.0.2 — MiniMax 标准版视频额度用尽 → Fast 版自动兜底: 配额错误判定 单测.
 */

import { describe, it, expect } from 'vitest';
import { isMinimaxVideoQuotaError } from '@/services/minimax.service';

describe('v7.0.2 · isMinimaxVideoQuotaError', () => {
  it('配额/额度类错误 → true (触发 Fast 兜底)', () => {
    expect(isMinimaxVideoQuotaError('Minimax video-01 error (2056): usage limit exceeded, 5-hour usage limit reached')).toBe(true);
    expect(isMinimaxVideoQuotaError('daily usage limit reached')).toBe(true);
    expect(isMinimaxVideoQuotaError('标准版额度用尽')).toBe(true);
    expect(isMinimaxVideoQuotaError('quota exceeded')).toBe(true);
    expect(isMinimaxVideoQuotaError('insufficient balance')).toBe(true);
    expect(isMinimaxVideoQuotaError('当前额度超出限制')).toBe(true);
  });
  it('非配额错误 → false (不误触发)', () => {
    expect(isMinimaxVideoQuotaError('Minimax video-01 error (1026): sensitive content')).toBe(false);
    expect(isMinimaxVideoQuotaError('timeout')).toBe(false);
    expect(isMinimaxVideoQuotaError('no task_id in response')).toBe(false);
    expect(isMinimaxVideoQuotaError('')).toBe(false);
  });
});
