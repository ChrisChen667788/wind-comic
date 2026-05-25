/**
 * v6.7 — API 健康分类 纯逻辑 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  isPlaceholder, classifyHttp, classifyMinimax, extractGatewayBalance, overallHealth,
  type ProviderHealth,
} from '@/lib/provider-health';

describe('v6.7 · isPlaceholder', () => {
  it('空 / 占位符 → true', () => {
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder('your_minimax_group_id_here')).toBe(true);
    expect(isPlaceholder('test-key')).toBe(true);
  });
  it('真 key → false', () => {
    expect(isPlaceholder('sk-ihO5Hw9ZNduhFio')).toBe(false);
  });
});

describe('v6.7 · classifyHttp', () => {
  it('200 → ok', () => expect(classifyHttp({ httpStatus: 200 }).status).toBe('ok'));
  it('402 → 额度用尽', () => expect(classifyHttp({ httpStatus: 402 }).status).toBe('out_of_credits'));
  it('401 通用 → 鉴权失败', () => expect(classifyHttp({ httpStatus: 401, body: 'unauthorized' }).status).toBe('auth_error'));
  it('401 + 额度关键词 → 额度用尽', () => {
    expect(classifyHttp({ httpStatus: 401, body: '该令牌额度已用尽' }).status).toBe('out_of_credits');
    expect(classifyHttp({ httpStatus: 401, body: 'insufficient quota' }).status).toBe('out_of_credits');
  });
  it('429 → 不可达; 429+额度 → 用尽', () => {
    expect(classifyHttp({ httpStatus: 429, body: 'too many requests' }).status).toBe('down');
    expect(classifyHttp({ httpStatus: 429, body: 'balance exceeded' }).status).toBe('out_of_credits');
  });
  it('500 / 网络错误 → 不可达', () => {
    expect(classifyHttp({ httpStatus: 500 }).status).toBe('down');
    expect(classifyHttp({ error: 'ECONNRESET' }).status).toBe('down');
    expect(classifyHttp({}).status).toBe('down');
  });
});

describe('v6.7 · classifyMinimax', () => {
  it('0 → ok', () => expect(classifyMinimax({ status_code: 0 }).status).toBe('ok'));
  it('1008 / 2054 → 额度用尽', () => {
    expect(classifyMinimax({ status_code: 1008, status_msg: 'insufficient balance' }).status).toBe('out_of_credits');
    expect(classifyMinimax({ status_code: 2054 }).status).toBe('out_of_credits');
  });
  it('1004 token not match group → 配置缺失', () => {
    expect(classifyMinimax({ status_code: 1004, status_msg: 'token not match group' }).status).toBe('misconfigured');
  });
  it('1004 其他 → 鉴权失败', () => {
    expect(classifyMinimax({ status_code: 1004, status_msg: 'invalid api key' }).status).toBe('auth_error');
  });
  it('2056 临时限流窗口 → 已配置可用 (ok), 不算欠费', () => {
    expect(classifyMinimax({ status_code: 2056, status_msg: 'usage limit exceeded, 5-hour usage limit reached' }).status).toBe('ok');
  });
  it('无 base_resp → 不可达', () => expect(classifyMinimax(null).status).toBe('down'));
});

describe('v6.7 · extractGatewayBalance', () => {
  it('limit + usage(分) → 剩余', () => {
    // hard_limit 30, usage 3004.927 分 ≈ $30.05 → 剩余 0
    expect(extractGatewayBalance({ hard_limit_usd: 30 }, 3004.927)).toEqual({ limitUsd: 30, usedUsd: 30.05, remainingUsd: 0 });
    expect(extractGatewayBalance({ hard_limit_usd: 30 }, 500)).toEqual({ limitUsd: 30, usedUsd: 5, remainingUsd: 25 });
  });
  it('缺 usage → 无剩余', () => {
    expect(extractGatewayBalance({ hard_limit_usd: 100 }, undefined).remainingUsd).toBeUndefined();
  });
});

describe('v6.7 · overallHealth', () => {
  const mk = (status: ProviderHealth['status']): ProviderHealth => ({ id: 'x', label: 'x', kind: 'gateway', status, detail: '' });
  it('有 bad → critical', () => expect(overallHealth([mk('ok'), mk('out_of_credits')])).toBe('critical'));
  it('有 warn 无 bad → warning', () => expect(overallHealth([mk('ok'), mk('misconfigured')])).toBe('warning'));
  it('全 ok → healthy', () => expect(overallHealth([mk('ok'), mk('ok')])).toBe('healthy'));
  it('not_configured (muted) 不拉低', () => expect(overallHealth([mk('ok'), mk('not_configured')])).toBe('healthy'));
});
