/**
 * v3.2 P3 — Plugin-chain feature flag.
 *
 * 三种 mode, 通过 env `PLUGIN_CHAIN_MODE` 控制:
 *
 *   off (default)  → 完全不走 plugin chain, 老 orchestrator 主路径 100% 保留.
 *                    现网兜底, 出问题立刻能滚回.
 *   shadow         → 老主路径正常出结果; 同时按 sample rate 异步跑 plugin chain,
 *                    收集 success-rate / latency diff 给 telemetry, 不影响真业务.
 *   primary        → 先试 plugin chain. 失败 (chain 空 / 全 throw) 才落老主路径.
 *                    确认 shadow 长时间稳定后再切到 primary.
 *
 * 第二个 env `PLUGIN_CHAIN_SHADOW_RATE` (0.0..1.0, default 0.05) 控制 shadow 模式
 * 的采样比例. 默认 5% — shadow 真的会调 API 烧钱, 别全量跑.
 *
 * 单元测试: tests/v3-2-plugin-chain-mode.test.ts.
 */

export type PluginChainMode = 'off' | 'shadow' | 'primary';

/** 解析 env, 不识别的值一律视为 'off' (最安全). */
export function getPluginChainMode(): PluginChainMode {
  const raw = (process.env.PLUGIN_CHAIN_MODE || '').trim().toLowerCase();
  if (raw === 'primary' || raw === 'shadow') return raw;
  if (raw === 'off') return 'off';
  // v10.4.0: mock 引擎必须经 plugin chain 才会被走到 —— MOCK_ENGINES=1 且未显式设
  // mode 时隐含 primary(显式 PLUGIN_CHAIN_MODE=off 仍然最高优先,上一行已短路)。
  if (process.env.MOCK_ENGINES === '1') return 'primary';
  return 'off';
}

/** shadow 模式采样比例, clamp 到 [0, 1]. 默认 0.05. */
export function getShadowSampleRate(): number {
  const raw = process.env.PLUGIN_CHAIN_SHADOW_RATE;
  if (!raw) return 0.05;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.05;
  return Math.max(0, Math.min(1, n));
}

/**
 * shadow 模式下决定这一次调用是否要跑 plugin chain.
 * 抽样函数, 可以注入 random source (测试时传 () => 0 表示 100% sample).
 */
export function shouldSampleShadow(rng: () => number = Math.random): boolean {
  return rng() < getShadowSampleRate();
}

// ─── Telemetry counters (进程级累计, 不持久化) ──────────────────────────
//
// 用户在 dev console 调 `pluginChainStats.snapshot()` 能看到此进程跑了多少 plugin /
// 命中率 / 失败原因分类. shadow mode 下还看 disagreement 数 (老 vs plugin 结果一致性).
//
// 为啥不写文件: orchestrator 多实例 (next dev / next start / vitest) 会互相
// 覆盖, 写文件意义不大. 真要长期 telemetry 上 OTel.

export interface PluginChainCounters {
  /** primary 模式: plugin 成功跑完返回结果的次数 */
  primaryHits: number;
  /** primary 模式: plugin chain 全失败, 落回老主路径的次数 */
  primaryFallbacks: number;
  /** shadow 模式: 被采样并启动 plugin 异步调用的次数 */
  shadowSampled: number;
  /** shadow 模式: plugin 异步调用成功 */
  shadowAgreed: number;
  /** shadow 模式: plugin 异步调用失败 (老主路径成功) */
  shadowDisagreed: number;
  /** 任何模式: plugin 内部 throw 收集 */
  errors: Record<string, number>;
}

const counters: PluginChainCounters = {
  primaryHits: 0,
  primaryFallbacks: 0,
  shadowSampled: 0,
  shadowAgreed: 0,
  shadowDisagreed: 0,
  errors: {},
};

export const pluginChainStats = {
  recordPrimaryHit() { counters.primaryHits++; },
  recordPrimaryFallback() { counters.primaryFallbacks++; },
  recordShadowSampled() { counters.shadowSampled++; },
  recordShadowAgreed() { counters.shadowAgreed++; },
  recordShadowDisagreed() { counters.shadowDisagreed++; },
  recordError(kind: string) {
    const k = kind.slice(0, 40);  // bound the key cardinality
    counters.errors[k] = (counters.errors[k] || 0) + 1;
  },
  snapshot(): PluginChainCounters {
    return JSON.parse(JSON.stringify(counters));
  },
  reset() {
    counters.primaryHits = 0;
    counters.primaryFallbacks = 0;
    counters.shadowSampled = 0;
    counters.shadowAgreed = 0;
    counters.shadowDisagreed = 0;
    counters.errors = {};
  },
};
