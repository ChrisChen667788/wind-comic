/**
 * v3.2 P3 — Plugin-chain orchestrator wrappers.
 *
 * 三个 `withXxxPlugin` 高阶函数, 把 orchestrator 老主路径变成 fallback,
 * plugin chain 变成可选 primary. 业务侧用法:
 *
 *   return await withImagePlugin(pluginInput, () => existingOrchestratorLogic());
 *
 * 看 lib/plugin-chain-mode.ts 解释三种 mode 怎么生效.
 *
 * 单元测试 tests/v3-2-plugin-chain-router.test.ts.
 */

import {
  getPluginChainMode,
  shouldSampleShadow,
  pluginChainStats,
} from './plugin-chain-mode';

import type { ImageGenerateInput } from './image-providers/types';
import type { VideoGenerateInput } from './video-providers/types';
import type { TTSGenerateInput, TTSGenerateResult } from './tts-providers/types';

// ─── Image ────────────────────────────────────────────────────────────────

/**
 * 调用 plugin image chain. 失败 throw, success 返 imageUrl.
 * 失败时记 stats.errors['image:<kind>'].
 */
async function tryImagePlugin(input: ImageGenerateInput): Promise<string> {
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
  return r.result.imageUrl;
}

/**
 * 老主路径 fallback 的统一封装. 接受一个 `fallback` 闭包 (调用方传 orchestrator 老逻辑),
 * 按 mode 决定是否先试 plugin.
 *
 * 注意 shadow 模式: 我们 await fallback 拿真结果给业务用, plugin 走 setTimeout(0) 异步
 * 跑只为收集 telemetry, 不让 plugin 失败拖慢业务.
 */
export async function withImagePlugin(
  input: ImageGenerateInput,
  fallback: () => Promise<string>,
): Promise<string> {
  const mode = getPluginChainMode();
  if (mode === 'off') return fallback();

  if (mode === 'primary') {
    try {
      const url = await tryImagePlugin(input);
      pluginChainStats.recordPrimaryHit();
      return url;
    } catch (e) {
      pluginChainStats.recordPrimaryFallback();
      pluginChainStats.recordError(`image:${(e instanceof Error ? e.message : String(e)).slice(0, 30)}`);
      return fallback();
    }
  }

  // shadow: fallback 拿真结果给业务, plugin 异步跑只为 telemetry
  const realPromise = fallback();
  if (shouldSampleShadow()) {
    pluginChainStats.recordShadowSampled();
    void (async () => {
      try {
        await tryImagePlugin(input);
        pluginChainStats.recordShadowAgreed();
      } catch (e) {
        pluginChainStats.recordShadowDisagreed();
        pluginChainStats.recordError(`image-shadow:${(e instanceof Error ? e.message : String(e)).slice(0, 30)}`);
      }
    })();
  }
  return realPromise;
}

// ─── Video ────────────────────────────────────────────────────────────────

async function tryVideoPlugin(input: VideoGenerateInput): Promise<string> {
  const { dispatchVideoGenerate } = await import('./video-providers/registry');
  const r = await dispatchVideoGenerate(input);
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`video plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  return r.result.videoUrl;
}

export async function withVideoPlugin(
  input: VideoGenerateInput,
  fallback: () => Promise<string>,
): Promise<string> {
  const mode = getPluginChainMode();
  if (mode === 'off') return fallback();

  if (mode === 'primary') {
    try {
      const url = await tryVideoPlugin(input);
      pluginChainStats.recordPrimaryHit();
      return url;
    } catch (e) {
      pluginChainStats.recordPrimaryFallback();
      pluginChainStats.recordError(`video:${(e instanceof Error ? e.message : String(e)).slice(0, 30)}`);
      return fallback();
    }
  }

  const realPromise = fallback();
  if (shouldSampleShadow()) {
    pluginChainStats.recordShadowSampled();
    void (async () => {
      try {
        await tryVideoPlugin(input);
        pluginChainStats.recordShadowAgreed();
      } catch (e) {
        pluginChainStats.recordShadowDisagreed();
        pluginChainStats.recordError(`video-shadow:${(e instanceof Error ? e.message : String(e)).slice(0, 30)}`);
      }
    })();
  }
  return realPromise;
}

// ─── TTS ──────────────────────────────────────────────────────────────────

async function tryTTSPlugin(input: TTSGenerateInput): Promise<TTSGenerateResult> {
  const { dispatchTTSGenerate } = await import('./tts-providers/registry');
  const r = await dispatchTTSGenerate(input);
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`tts plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  return r.result;
}

/**
 * TTS 的 fallback 返结构化 result (audioUrl + duration + subtitle), 不是单 URL,
 * 因此 wrapper signature 也是返 TTSGenerateResult.
 */
export async function withTTSPlugin(
  input: TTSGenerateInput,
  fallback: () => Promise<TTSGenerateResult>,
): Promise<TTSGenerateResult> {
  const mode = getPluginChainMode();
  if (mode === 'off') return fallback();

  if (mode === 'primary') {
    try {
      const r = await tryTTSPlugin(input);
      pluginChainStats.recordPrimaryHit();
      return r;
    } catch (e) {
      pluginChainStats.recordPrimaryFallback();
      pluginChainStats.recordError(`tts:${(e instanceof Error ? e.message : String(e)).slice(0, 30)}`);
      return fallback();
    }
  }

  const realPromise = fallback();
  if (shouldSampleShadow()) {
    pluginChainStats.recordShadowSampled();
    void (async () => {
      try {
        await tryTTSPlugin(input);
        pluginChainStats.recordShadowAgreed();
      } catch (e) {
        pluginChainStats.recordShadowDisagreed();
        pluginChainStats.recordError(`tts-shadow:${(e instanceof Error ? e.message : String(e)).slice(0, 30)}`);
      }
    })();
  }
  return realPromise;
}
