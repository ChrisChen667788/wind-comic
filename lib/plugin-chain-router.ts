/**
 * v3.2 P3 / P4 — Plugin-chain orchestrator wrappers.
 *
 * 三个 `withXxxPlugin` 高阶函数, 把 orchestrator 老主路径变成 fallback,
 * plugin chain 变成可选 primary. 业务侧用法:
 *
 *   return await withImagePlugin(pluginInput, () => existingOrchestratorLogic());
 *
 * 看 lib/plugin-chain-mode.ts 解释三种 mode 怎么生效.
 * v3.2 P4: 每次调用通过 lib/plugin-chain-telemetry 落 SQLite, admin 面板能看
 * 真实 success-rate / latency, 决定 shadow → primary 切换时机.
 *
 * 单元测试 tests/v3-2-plugin-chain-router.test.ts.
 */

import {
  getPluginChainMode,
  shouldSampleShadow,
  pluginChainStats,
} from './plugin-chain-mode';
import { recordPluginEvent, type PluginEventKind } from './plugin-chain-telemetry';

import type { ImageGenerateInput } from './image-providers/types';
import type { VideoGenerateInput } from './video-providers/types';
import type { TTSGenerateInput, TTSGenerateResult } from './tts-providers/types';

// ─── Generic core ───────────────────────────────────────────────────────────

interface PluginAttempt<T> {
  value: T;
  provider?: string;
}

/**
 * 三个 wrapper 共享的核心. 按 mode 决定走 plugin 还是 fallback, 统一记
 * 进程级 counter (pluginChainStats) + 持久化 telemetry (recordPluginEvent).
 *
 * shadow 模式: await fallback 拿真结果给业务, plugin 异步采样跑只为 telemetry,
 * plugin 失败不影响业务.
 */
async function runWithPlugin<T>(
  kind: PluginEventKind,
  tryPlugin: () => Promise<PluginAttempt<T>>,
  fallback: () => Promise<T>,
  onProvider?: (provider?: string) => void, // v12.29.0(P1):primary 命中时回传真出片 provider id
): Promise<T> {
  const mode = getPluginChainMode();
  if (mode === 'off') return fallback();

  if (mode === 'primary') {
    const t0 = Date.now();
    try {
      const { value, provider } = await tryPlugin();
      pluginChainStats.recordPrimaryHit();
      onProvider?.(provider);
      void recordPluginEvent({ kind, mode: 'primary', outcome: 'primary_hit', provider, latencyMs: Date.now() - t0 });
      return value;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pluginChainStats.recordPrimaryFallback();
      pluginChainStats.recordError(`${kind}:${msg.slice(0, 30)}`);
      void recordPluginEvent({ kind, mode: 'primary', outcome: 'primary_fallback', latencyMs: Date.now() - t0, error: msg });
      return fallback();
    }
  }

  // shadow
  const realPromise = fallback();
  if (shouldSampleShadow()) {
    pluginChainStats.recordShadowSampled();
    void (async () => {
      const t0 = Date.now();
      try {
        const { provider } = await tryPlugin();
        pluginChainStats.recordShadowAgreed();
        void recordPluginEvent({ kind, mode: 'shadow', outcome: 'shadow_agree', provider, latencyMs: Date.now() - t0 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pluginChainStats.recordShadowDisagreed();
        pluginChainStats.recordError(`${kind}-shadow:${msg.slice(0, 30)}`);
        void recordPluginEvent({ kind, mode: 'shadow', outcome: 'shadow_disagree', latencyMs: Date.now() - t0, error: msg });
      }
    })();
  }
  return realPromise;
}

// ─── Image ────────────────────────────────────────────────────────────────

async function tryImagePlugin(input: ImageGenerateInput): Promise<PluginAttempt<string>> {
  const { dispatchImageGenerate } = await import('./image-providers/registry');
  const refCount = [
    ...(input.referenceImages || []),
    ...(input.cref ? [input.cref] : []),
    ...(input.sref ? [input.sref] : []),
  ].filter((u) => !!u).length;
  const r = await dispatchImageGenerate(input, { refCount });
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`image plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  return { value: r.result.imageUrl, provider: r.result.provider };
}

export async function withImagePlugin(
  input: ImageGenerateInput,
  fallback: () => Promise<string>,
): Promise<string> {
  return runWithPlugin('image', () => tryImagePlugin(input), fallback);
}

// ─── Video ────────────────────────────────────────────────────────────────

async function tryVideoPlugin(input: VideoGenerateInput): Promise<PluginAttempt<string>> {
  const { dispatchVideoGenerate } = await import('./video-providers/registry');
  const r = await dispatchVideoGenerate(input);
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`video plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  return { value: r.result.videoUrl, provider: r.result.provider };
}

export async function withVideoPlugin(
  input: VideoGenerateInput,
  fallback: () => Promise<string>,
  onProvider?: (provider?: string) => void, // v12.29.0(P1):回传真出片 provider id(供原生音画判定)
): Promise<string> {
  return runWithPlugin('video', () => tryVideoPlugin(input), fallback, onProvider);
}

// ─── TTS ──────────────────────────────────────────────────────────────────

async function tryTTSPlugin(input: TTSGenerateInput): Promise<PluginAttempt<TTSGenerateResult>> {
  const { dispatchTTSGenerate } = await import('./tts-providers/registry');
  const r = await dispatchTTSGenerate(input);
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`tts plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  return { value: r.result, provider: r.result.provider };
}

export async function withTTSPlugin(
  input: TTSGenerateInput,
  fallback: () => Promise<TTSGenerateResult>,
): Promise<TTSGenerateResult> {
  return runWithPlugin('tts', () => tryTTSPlugin(input), fallback);
}
