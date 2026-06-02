/**
 * v3.2 P4.1 — Plugin telemetry persistence (真 SQLite).
 * v9.0.4e: recordPluginEvent / aggregatePluginStats 异步化 (走 DbDriver 双驱动), 测试改 async。
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
  it('inserts a row', async () => {
    const before = countEvents();
    await recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_hit', provider: 'mj', latencyMs: 1200 });
    expect(countEvents()).toBe(before + 1);
  });

  it('never throws on weird input + 截断 error 到 200', async () => {
    await recordPluginEvent({
      kind: 'video', mode: 'shadow', outcome: 'shadow_disagree',
      error: 'x'.repeat(5000), // 超长 error 应被截断
    });
    const row = db.prepare(
      `SELECT error FROM plugin_chain_events WHERE outcome='shadow_disagree' ORDER BY created_at DESC LIMIT 1`,
    ).get() as { error: string };
    expect(row.error.length).toBeLessThanOrEqual(200);
  });

  it('accepts null provider/latency/error', async () => {
    const before = countEvents();
    await recordPluginEvent({ kind: 'tts', mode: 'primary', outcome: 'primary_fallback' });
    expect(countEvents()).toBe(before + 1);
  });
});

describe('v3.2 P4.1 · aggregatePluginStats', () => {
  it('aggregates by kind with rates', async () => {
    await recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_hit', provider: 'mj', latencyMs: 1000 });
    await recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_hit', provider: 'mj', latencyMs: 2000 });
    await recordPluginEvent({ kind: 'image', mode: 'primary', outcome: 'primary_fallback' });

    const stats = await aggregatePluginStats();
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

  it('sinceMs window returns a summary shape', async () => {
    const stats = await aggregatePluginStats(60 * 60 * 1000); // last hour
    expect(stats).toHaveProperty('rows');
    expect(stats).toHaveProperty('cutoverReady');
    expect(Array.isArray(stats.rows)).toBe(true);
    expect(typeof stats.cutoverReady).toBe('boolean');
  });

  it('cutoverReady is false when shadow agree-rate below threshold', async () => {
    // 制造一批 video shadow_disagree 把一致率压到阈值以下
    for (let i = 0; i < 5; i++) {
      await recordPluginEvent({ kind: 'video', mode: 'shadow', outcome: 'shadow_disagree', error: 'boom' });
    }
    const stats = await aggregatePluginStats();
    // 全局 cutoverReady 不该因为有大量 disagree 而 true
    expect(stats.cutoverReady).toBe(false);
  });
});
