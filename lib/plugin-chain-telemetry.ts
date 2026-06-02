/**
 * v3.2 P4.1 — Plugin-chain 遥测持久化.
 *
 * lib/plugin-chain-mode.ts 的 pluginChainStats 是进程级内存计数, 重启即丢, 多进程
 * (next dev / start / vitest) 还互相看不见. 这文件把每次 plugin chain 调用落到
 * SQLite plugin_chain_events 表, admin 面板能聚合出真实 success-rate / latency diff,
 * 决定 shadow → primary 切换时机.
 *
 * 设计:
 *   - server-only. 任何 import 失败 / 无 DB (jsdom 测试) 都静默跳过, 绝不抛.
 *   - recordPluginEvent 是 best-effort fire-and-forget, 不阻塞业务.
 *   - aggregatePluginStats 给 admin API 用, 按 kind × outcome 聚合 + 算成功率.
 *
 * 单测: tests/v3-2-plugin-chain-telemetry.test.ts (跑真 SQLite).
 */

import { nanoid } from 'nanoid';
import { now } from '@/lib/db';
import { getDbDriver } from '@/lib/db-driver';

export type PluginEventKind = 'image' | 'video' | 'tts';
export type PluginEventMode = 'primary' | 'shadow';
export type PluginEventOutcome =
  | 'primary_hit'
  | 'primary_fallback'
  | 'shadow_agree'
  | 'shadow_disagree';

export interface PluginEvent {
  kind: PluginEventKind;
  mode: PluginEventMode;
  outcome: PluginEventOutcome;
  provider?: string | null;
  latencyMs?: number | null;
  error?: string | null;
}

/**
 * 落一条 plugin 事件. best-effort — 拿不到 DB 就跳过, 永不抛 (业务路径上调用).
 */
export async function recordPluginEvent(ev: PluginEvent): Promise<void> {
  try {
    await getDbDriver().run(
      `INSERT INTO plugin_chain_events
        (id, kind, mode, outcome, provider, latency_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        ev.kind,
        ev.mode,
        ev.outcome,
        ev.provider ?? null,
        ev.latencyMs ?? null,
        ev.error ? String(ev.error).slice(0, 200) : null,
        now(),
      ],
    );
  } catch {
    // swallow — 遥测永远不能拖垮业务
  }
}

export interface PluginStatsRow {
  kind: PluginEventKind;
  total: number;
  primaryHit: number;
  primaryFallback: number;
  shadowAgree: number;
  shadowDisagree: number;
  /** primary 模式命中率 = primaryHit / (primaryHit + primaryFallback) */
  primaryHitRate: number | null;
  /** shadow 模式一致率 = shadowAgree / (shadowAgree + shadowDisagree) */
  shadowAgreeRate: number | null;
  /** 命中事件的平均 latency (ms), 无样本时 null */
  avgLatencyMs: number | null;
}

export interface PluginStatsSummary {
  sinceMs: number | null;
  rows: PluginStatsRow[];
  /** 是否所有 kind 的 shadow 一致率都 ≥ 阈值 — 给"可以切 primary 了"提示 */
  cutoverReady: boolean;
}

const CUTOVER_AGREE_THRESHOLD = 0.98;
const CUTOVER_MIN_SAMPLES = 50;

/**
 * 聚合最近 sinceMs 毫秒内的事件 (不传 = 全部). 给 admin API.
 */
export async function aggregatePluginStats(sinceMs?: number): Promise<PluginStatsSummary> {
  const empty: PluginStatsSummary = { sinceMs: sinceMs ?? null, rows: [], cutoverReady: false };
  try {
    const params: any[] = [];
    let where = '';
    if (sinceMs && Number.isFinite(sinceMs)) {
      where = 'WHERE created_at >= ?';
      params.push(new Date(Date.now() - sinceMs).toISOString());
    }
    const rows = (await getDbDriver().query(
      `SELECT
         kind,
         COUNT(*) AS "total",
         SUM(CASE WHEN outcome = 'primary_hit' THEN 1 ELSE 0 END) AS "primaryHit",
         SUM(CASE WHEN outcome = 'primary_fallback' THEN 1 ELSE 0 END) AS "primaryFallback",
         SUM(CASE WHEN outcome = 'shadow_agree' THEN 1 ELSE 0 END) AS "shadowAgree",
         SUM(CASE WHEN outcome = 'shadow_disagree' THEN 1 ELSE 0 END) AS "shadowDisagree",
         AVG(latency_ms) AS "avgLatencyMs"
       FROM plugin_chain_events
       ${where}
       GROUP BY kind`,
      params,
    )) as any[];

    const out: PluginStatsRow[] = rows.map((r) => {
      // PG 的 COUNT/SUM/AVG 返回 string/bigint → Number() 归一 (SQLite 已是 number)
      const total = Number(r.total) || 0;
      const primaryHit = Number(r.primaryHit) || 0;
      const primaryFallback = Number(r.primaryFallback) || 0;
      const shadowAgree = Number(r.shadowAgree) || 0;
      const shadowDisagree = Number(r.shadowDisagree) || 0;
      const primaryDenom = primaryHit + primaryFallback;
      const shadowDenom = shadowAgree + shadowDisagree;
      return {
        kind: r.kind,
        total,
        primaryHit,
        primaryFallback,
        shadowAgree,
        shadowDisagree,
        primaryHitRate: primaryDenom > 0 ? primaryHit / primaryDenom : null,
        shadowAgreeRate: shadowDenom > 0 ? shadowAgree / shadowDenom : null,
        avgLatencyMs: r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null,
      };
    });

    // cutover-ready: 至少有数据, 且每个有 shadow 样本的 kind 一致率达标 + 样本够
    const shadowKinds = out.filter((r) => (r.shadowAgree + r.shadowDisagree) > 0);
    const cutoverReady =
      shadowKinds.length > 0 &&
      shadowKinds.every(
        (r) =>
          (r.shadowAgree + r.shadowDisagree) >= CUTOVER_MIN_SAMPLES &&
          (r.shadowAgreeRate ?? 0) >= CUTOVER_AGREE_THRESHOLD,
      );

    return { sinceMs: sinceMs ?? null, rows: out, cutoverReady };
  } catch {
    return empty;
  }
}

export const TELEMETRY_TUNING = {
  CUTOVER_AGREE_THRESHOLD,
  CUTOVER_MIN_SAMPLES,
};
