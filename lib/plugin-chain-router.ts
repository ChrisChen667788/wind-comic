/**
 * v3.2 P3 / P4 — Plugin-chain orchestrator wrappers.
 *
 * 四个 `withXxxPlugin` 高阶函数(v12.352 起含 lipsync), 把 orchestrator 老主路径变成 fallback,
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
  type PluginChainMode,
} from './plugin-chain-mode';
import { recordPluginEvent, type PluginEventKind } from './plugin-chain-telemetry';

import type { ImageGenerateInput } from './image-providers/types';
import type { VideoGenerateInput } from './video-providers/types';
import type { TTSGenerateInput, TTSGenerateResult } from './tts-providers/types';
import type { LipSyncGenerateInput, LipSyncGenerateResult } from './lipsync-providers/types';

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
  modeOverride?: PluginChainMode,           // v12.239:某一路自行判定要不要开(见 withImagePlugin)
): Promise<T> {
  const mode = modeOverride || getPluginChainMode();
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
  // v12.393:与 provider 同一口径。原来这里只 `.filter(u => !!u)` ——
  // 而 provider 内部还要求 http 前缀并去重,于是一个 data: URI 会让
  // router 算出 1、provider 算出 0,v12.371 的 minRefImages 下界形同虚设。
  const { countUsableRefs } = await import('./image-providers/refs');
  const refCount = countUsableRefs(input);
  const r = await dispatchImageGenerate(input, { refCount });
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`image plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  // v12.397:降级标记要透出插件链边界,否则标了也没人看得见
  return { value: r.result.imageUrl, provider: r.result.provider + (r.result.refsIgnored ? '(no-ref)' : '') };
}

/** registry 里的**内置** provider id —— 它们只是老引擎的 adapter,不算「用户新接的」。 */
const BUILTIN_IMAGE_PROVIDER_IDS = new Set([
  'mj', 'minimax-multi', 'minimax-single', 'kontext', 'mock-image',
]);

/**
 * v12.239(issue #11 交付缺陷自查):判断是否存在**用户显式配置启用的自定义图像 provider**。
 *
 * 病根:v12.238 把 GPT Image / Nano Banana 注册进了 registry,并对外(issue #11)声称
 * 「配好 key 就会先于内置链跑」—— **但那是错的**。`getPluginChainMode()` 默认返回 'off',
 * 而 runWithPlugin 在 off 时直接 return fallback()、**根本不调 tryPlugin**,
 * 于是注册进来的 provider 永远不会被调用:功能等于没接,对外声明也成了虚报。
 * 我当时只验了 selectProviders 的排序(判定层),没验这条链会不会被调用(消费方)——
 * 与本轮加固里反复出现的「改了判定层没跟到消费方」是同一个病。
 *
 * 修法沿用项目既有先例:`getPluginChainMode()` 里 `MOCK_ENGINES=1` 就是「这类 provider 必须经
 * plugin chain 才走得到,故隐含 primary」。这里同理,但**只作用于图像这一路**(不动 video/tts),
 * 且只在用户**主动配了新 key/开关**时才触发 —— 没配的用户行为零变化。
 */
async function hasEnabledCustomImageProvider(refCount: number): Promise<boolean> {
  try {
    const { selectProviders } = await import('./image-providers/registry');
    return selectProviders({ refCount }).some((p) => !BUILTIN_IMAGE_PROVIDER_IDS.has(p.id));
  } catch {
    return false;
  }
}

export async function withImagePlugin(
  input: ImageGenerateInput,
  fallback: () => Promise<string>,
): Promise<string> {
  let modeOverride: PluginChainMode | undefined;
  // v12.239:必须区分「用户显式设了 off」与「没设、默认 off」——
  // 前者是用户明确要关掉整条 plugin 链,隐含开启会夺走他的一票否决权(这条是被自己的测试抓到的)。
  const rawMode = (process.env.PLUGIN_CHAIN_MODE || '').trim().toLowerCase();
  const explicitlySet = rawMode === 'off' || rawMode === 'primary' || rawMode === 'shadow';
  if (!explicitlySet && getPluginChainMode() === 'off') {
    const refCount = [
      ...(input.referenceImages || []),
      ...(input.cref ? [input.cref] : []),
      ...(input.sref ? [input.sref] : []),
    ].filter(Boolean).length;
    // 全局链关着,但用户显式启用了自定义 provider → 只把图像这一路提为 primary,
    // 让它真的跑起来;失败仍自动 fallback 回内置链(runWithPlugin 的既有语义)。
    if (await hasEnabledCustomImageProvider(refCount)) modeOverride = 'primary';
  }
  return runWithPlugin('image', () => tryImagePlugin(input), fallback, undefined, modeOverride);
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

// ─── LipSync(v12.352) ─────────────────────────────────────────────────────
//
// 注册表 `lib/lipsync-providers` 从 v12.213 就齐了(register / select / dispatch 都在),
// 唯独**没有 wrapper** —— 于是口型这一路始终只走 orchestrator 老路径,
// 用户即便注册了自己的口型 provider 也永远不会被调用,而且**一条遥测都没有**:
// admin 的 plugin-stats 面板上 image/video/tts 三条曲线,lipsync 是空的。
//
// 与 image 那条不同,这里**不需要**「是否存在自定义 provider」的额外判定 ——
// lipsync 注册表里本来就没有「内置 adapter 冒充插件」的问题(见 withImagePlugin 的
// BUILTIN_IMAGE_PROVIDER_IDS 注释),所以沿用默认 mode 即可。

async function tryLipSyncPlugin(input: LipSyncGenerateInput): Promise<PluginAttempt<LipSyncGenerateResult>> {
  const { dispatchLipSyncGenerate } = await import('./lipsync-providers/registry');
  const r = await dispatchLipSyncGenerate(input);
  if (!r.result) {
    const reasons = r.tried.map((t) => t.error).join(' | ').slice(0, 60);
    throw new Error(`lipsync plugin chain empty / all-failed: ${reasons || 'no providers'}`);
  }
  return { value: r.result, provider: r.result.provider };
}

export async function withLipSyncPlugin(
  input: LipSyncGenerateInput,
  fallback: () => Promise<LipSyncGenerateResult>,
): Promise<LipSyncGenerateResult> {
  return runWithPlugin('lipsync', () => tryLipSyncPlugin(input), fallback);
}
