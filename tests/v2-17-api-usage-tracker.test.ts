/**
 * Tests for v2.17 P0.1 — lib/api-usage-tracker
 *
 * 锁:
 *   - detectQuotaError 各 provider 的匹配规则 (Minimax 1008 / OpenAI 429 / Veo saturated 等)
 *   - recordApiCall 失败时落表 + 触发 alert; 成功不落表
 *   - upsertQuotaAlert 1h 窗口内同 provider+type 聚合 occurrence_count
 *   - withApiTracking wrapper 抛错时录 + 重抛, 成功不录
 *   - acknowledgeQuotaAlert 关掉 alert
 *
 * 用真 sqlite (better-sqlite3 + jsdom 单 fork mode 行为可控)。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectQuotaError,
  recordApiCall,
  withApiTracking,
  ApiCallError,
  listActiveQuotaAlerts,
  acknowledgeQuotaAlert,
} from '@/lib/api-usage-tracker';
import { db } from '@/lib/db';

// 每个 case 前清空两个表 — 防止上一个测试的 alert 干扰
beforeEach(() => {
  db.prepare('DELETE FROM api_usage_events').run();
  db.prepare('DELETE FROM api_quota_alerts').run();
});

describe('detectQuotaError', () => {
  it('Minimax 1008 → exhausted', () => {
    expect(detectQuotaError('minimax', 1008, '账户余额不足')).toBe('exhausted');
    expect(detectQuotaError('minimax', undefined, '余额不足')).toBe('exhausted');
  });

  it('Minimax 2061 → model_unavailable (套餐不支持此模型, 不是鉴权问题) — v2.22 fix', () => {
    expect(detectQuotaError('minimax', 2061, 'plan not support')).toBe('model_unavailable');
    expect(detectQuotaError('minimax', undefined, 'your current token plan not support model, I2V-01'))
      .toBe('model_unavailable');
    // 1004 仍是真鉴权失败
    expect(detectQuotaError('minimax', 1004, 'auth fail')).toBe('auth_failed');
  });

  it('OpenAI insufficient_quota → exhausted', () => {
    expect(detectQuotaError('openai', undefined, 'You exceeded insufficient_quota'))
      .toBe('exhausted');
    expect(detectQuotaError('openai', undefined, 'user quota is not enough'))
      .toBe('exhausted');
  });

  it('OpenAI 429 → rate_limited', () => {
    expect(detectQuotaError('openai', 429, 'too many requests')).toBe('rate_limited');
  });

  it('OpenAI 401/403 → auth_failed', () => {
    expect(detectQuotaError('openai', 401, 'unauthorized')).toBe('auth_failed');
    expect(detectQuotaError('openai', 403, 'forbidden')).toBe('auth_failed');
  });

  it('Midjourney insufficient credits → exhausted', () => {
    expect(detectQuotaError('midjourney', undefined, 'credits insufficient')).toBe('exhausted');
  });

  it('Midjourney queue full → saturated', () => {
    expect(detectQuotaError('midjourney', undefined, 'queue full, retry later')).toBe('saturated');
  });

  it('Veo upstream saturated → saturated', () => {
    expect(detectQuotaError('veo', undefined, 'pre_consume_token_quota_failed'))
      .toBe('saturated');
    expect(detectQuotaError('veo', undefined, '上游负载已饱和')).toBe('saturated');
  });

  it('returns null for non-quota errors', () => {
    expect(detectQuotaError('minimax', 500, 'internal error')).toBeNull();
    expect(detectQuotaError('openai', undefined, 'random parse error')).toBeNull();
  });

  it('returns null for unknown provider', () => {
    expect(detectQuotaError('unknown' as any, 1008, 'x')).toBeNull();
  });
});

describe('recordApiCall', () => {
  it('writes failed call to api_usage_events', async () => {
    await recordApiCall({
      provider: 'minimax',
      model: 'I2V-01',
      method: 'generateVideo',
      success: false,
      statusCode: 1008,
      errorMessage: '余额不足',
    });
    const rows = db.prepare('SELECT * FROM api_usage_events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe('minimax');
    expect(rows[0].model).toBe('I2V-01');
    expect(rows[0].status_code).toBe(1008);
    expect(rows[0].error_message).toBe('余额不足');
    expect(rows[0].success).toBe(0);
  });

  it('does NOT write successful calls (write amplification mitigation)', async () => {
    await recordApiCall({
      provider: 'minimax',
      model: 'I2V-01',
      method: 'generateVideo',
      success: true,
    });
    const rows = db.prepare('SELECT * FROM api_usage_events').all();
    expect(rows).toHaveLength(0);
  });

  it('truncates long error messages to ≤200 chars', async () => {
    const longMsg = 'x'.repeat(500);
    await recordApiCall({
      provider: 'openai',
      model: 'gpt-4o',
      method: 'chat',
      success: false,
      errorMessage: longMsg,
    });
    const row = db.prepare('SELECT error_message FROM api_usage_events').get() as any;
    expect(row.error_message.length).toBeLessThanOrEqual(200);
  });

  it('quota error → also creates alert in api_quota_alerts', async () => {
    await recordApiCall({
      provider: 'minimax',
      model: 'I2V-01',
      method: 'generateVideo',
      success: false,
      statusCode: 1008,
      errorMessage: '账户余额不足',
    });
    const alerts = await listActiveQuotaAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].provider).toBe('minimax');
    expect(alerts[0].alertType).toBe('exhausted');
    expect(alerts[0].occurrenceCount).toBe(1);
  });

  it('non-quota failure does NOT create alert', async () => {
    await recordApiCall({
      provider: 'minimax',
      model: 'I2V-01',
      method: 'generateVideo',
      success: false,
      statusCode: 500,
      errorMessage: 'internal server error',
    });
    expect(await listActiveQuotaAlerts()).toHaveLength(0);
  });

  it('repeated quota errors aggregate occurrence_count (1h window)', async () => {
    for (let i = 0; i < 3; i++) {
      await recordApiCall({
        provider: 'minimax',
        success: false,
        statusCode: 1008,
        errorMessage: `余额不足 ${i}`,
      });
    }
    const alerts = await listActiveQuotaAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].occurrenceCount).toBe(3);
  });

  it('different providers create separate alerts', async () => {
    await recordApiCall({ provider: 'minimax', success: false, statusCode: 1008, errorMessage: '余额不足' });
    await recordApiCall({ provider: 'openai', success: false, errorMessage: 'insufficient_quota' });
    const alerts = await listActiveQuotaAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.provider).sort()).toEqual(['minimax', 'openai']);
  });

  it('different alert types in same provider are separate', async () => {
    await recordApiCall({ provider: 'minimax', success: false, statusCode: 1008, errorMessage: '余额不足' });
    await recordApiCall({ provider: 'minimax', success: false, statusCode: 2061, errorMessage: 'plan not support' });
    const alerts = await listActiveQuotaAlerts({ provider: 'minimax' });
    // v2.22 fix: 2061 重分类为 model_unavailable (之前是 auth_failed)
    expect(alerts.map((a) => a.alertType).sort()).toEqual(['exhausted', 'model_unavailable']);
  });
});

describe('acknowledgeQuotaAlert', () => {
  it('removes alert from active list', async () => {
    await recordApiCall({
      provider: 'minimax', success: false, statusCode: 1008, errorMessage: '余额不足',
    });
    const alerts = await listActiveQuotaAlerts();
    expect(alerts).toHaveLength(1);
    await acknowledgeQuotaAlert(alerts[0].id);
    expect(await listActiveQuotaAlerts()).toHaveLength(0);
  });
});

describe('withApiTracking', () => {
  it('records on throw + rethrows', async () => {
    await expect(
      withApiTracking(
        { provider: 'minimax', model: 'I2V-01', method: 'generateVideo' },
        async () => {
          throw new ApiCallError(1008, '余额不足');
        },
      ),
    ).rejects.toThrow(/余额不足/);
    const rows = db.prepare('SELECT * FROM api_usage_events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status_code).toBe(1008);
  });

  it('does NOT record on success', async () => {
    const result = await withApiTracking(
      { provider: 'minimax', model: 'I2V-01', method: 'generateVideo' },
      async () => 'http://example.com/v.mp4',
    );
    expect(result).toBe('http://example.com/v.mp4');
    expect(db.prepare('SELECT COUNT(*) AS c FROM api_usage_events').get()).toEqual({ c: 0 });
  });

  it('extracts statusCode from ApiCallError, omits when plain Error', async () => {
    await expect(
      withApiTracking(
        { provider: 'openai', method: 'chat' },
        async () => {
          throw new Error('plain error no code');
        },
      ),
    ).rejects.toThrow();
    const row = db.prepare('SELECT status_code FROM api_usage_events').get() as any;
    expect(row.status_code).toBeNull();
  });
});
