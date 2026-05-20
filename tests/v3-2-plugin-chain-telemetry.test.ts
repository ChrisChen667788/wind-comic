/**
 * v3.2 P4.1 — Plugin telemetry persistence (真 SQLite).
 *
 * 用 before/after 行数差断言, 对其他测试写入的 plugin_chain_events 行免疫.
 */

import { describe, it, expect } from 'vitest';
import {
  recordPluginEvent,
  aggregatePluginStats,
  TELEMETRY_TUNING,
} from '@/lib/plugin-chain-telemetry';
import { db } from '@/lib/db';

function countEvents(): number {
  const r = db.prepare('SELECT COUNT(*) AS c FROM plugin_chain_events').get() as { c: number };
  return r.c;
}

describe('v3.2 P4.1 · recordPluginEvent', () => {
  it('inserts a row', () => {
    const before = countEvents();
    recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_hit', provider: 'mj', latencyMs: 1200 });
    expect(countEvents()).toBe(before + 1);
  });

  it('never throws on weird input', () => {
    expect(() => recordPluginEvent({
      kind: 'video', mode: 'shadow', outcome: 'shadow_disagree',
      error: 'x'.repeat(5000), // 超长 error 应被截断
    })).not.toThrow();
    // 验证 error 被截断到 200
    const row = db.prepare(
      `SELECT error FROM plugin_chain_events WHERE outcome='shadow_disagree' ORDER BY created_at DESC LIMIT 1`,
    ).get() as { error: string };
    expect(row.error.length).toBeLessThanOrEqual(200);
  });

  it('accepts null provider/latency/error', () => {
    const before = countEvents();
    recordPluginEvent({ kind: 'tts', mode: 'primary', outcome: 'primary_fallback' });
    expect(countEvents()).toBe(before + 1);
  });
});

describe('v3.2 P4.1 · aggregatePluginStats', () => {
  it('aggregates by kind with rates', () => {
    // 写一组已知事件 — 用唯一 kind 不太可能, 但用 delta 思路: 取 image 行聚合
    // 注意: 其他测试也写 image 事件, 所以这里只验证结构 + 算术不为负, 不验证绝对值
    recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_hit', provider: 'mj', latencyMs: 1000 });
    recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_hit', provider: 'mj', latencyMs: 2000 });
    recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_fallback' });

    const stats = aggregatePluginStats();
    const imageRow = stats.rows.find((r) => r.kind === 'image');
    expect(imageRow).toBeDefined();
    if (imageRow) {
      expect(imageRow.primaryHit).toBeGreaterThanOrEqual(2);
      expect(imageRow.primaryFallback).toBeGreaterThanOrEqual(1);
      // 命中率 = hit / (hit + fallback), 介于 0..1
      expect(imageRow.primaryHitRate).not.toBeNull();
      if (imageRow.primaryHitRate != null) {
        expect(imageRow.primaryHitRate).toBeGreaterThan(0);
        expect(imageRow.primaryHitRate).toBeLessThanOrEqual(1);
      }
      expect(imageRow.avgLatencyMs).not.toBeNull();
    }
  });

  it('exposes cutover tuning constants', () => {
    expect(TELEMETRY_TUNING.CUTOVER_AGREE_THRESHOLD).toBeGreaterThan(0.9);
    expect(TELEMETRY_TUNING.CUTOVER_MIN_SAMPLES).toBeGreaterThan(0);
  });

  it('sinceMs window filters out ancient rows (smoke: returns a summary shape)', () => {
    const stats = aggregatePluginStats(60 * 60 * 1000); // last hour
    expect(stats).toHaveProperty('rows');
    expect(stats).toHaveProperty('cutoverReady');
    expect(Array.isArray(stats.rows)).toBe(true);
    expect(typeof stats.cutoverReady).toBe('boolean');
  });

  it('cutoverReady is false when shadow agree-rate below threshold', () => {
    // 制造一批 video shadow_disagree 把一致率压到阈值以下
    for (let i = 0; i < 5; i++) {
      recordPluginEvent({ kind: 'video', mode: 'shadow', outcome: 'shadow_disagree', error: 'boom' });
    }
    const stats = aggregatePluginStats();
    // 全局 cutoverReady 不该因为有大量 disagree 而 true
    expect(stats.cutoverReady).toBe(false);
  });
});
