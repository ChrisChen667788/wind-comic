/**
 * lib/lipsync-providers/registry (v9.6.9) — LipSyncProvider 注册表 + 调度器。
 *
 * selectLipSyncProviders 过滤(available + 能力)+ 排序(prefer → priority);
 * dispatchLipSyncGenerate 顺序跑选出的链,第一个成功的用,失败自动 fallback。
 * 对齐 video-providers/registry。
 */
import type { LipSyncProvider, LipSyncSelectInput, LipSyncGenerateInput, LipSyncGenerateResult } from './types';

const providers = new Map<string, LipSyncProvider>();

export function registerLipSyncProvider(p: LipSyncProvider): void {
  if (!p || !p.id || typeof p.generate !== 'function') {
    throw new Error('[LipSyncProviders] register: missing required fields (id / generate)');
  }
  if (typeof p.priority !== 'number') {
    throw new Error(`[LipSyncProviders] register("${p.id}"): priority must be number`);
  }
  providers.set(p.id, p);
}

export function clearLipSyncProviders(): void {
  providers.clear();
}

export function listLipSyncProviders(): LipSyncProvider[] {
  return [...providers.values()];
}

export function getLipSyncProvider(id: string): LipSyncProvider | undefined {
  return providers.get(id);
}

/** 至少一个 provider available → 引擎已配置。 */
export function lipSyncEngineConfigured(): boolean {
  return [...providers.values()].some((p) => safeAvailable(p));
}

function safeAvailable(p: LipSyncProvider): boolean {
  try { return p.available(); } catch { return false; }
}

/** 过滤(available + 视频底板能力)+ 排序(prefer 顶头 → priority 升序)。 */
export function selectLipSyncProviders(input: LipSyncSelectInput = {}): LipSyncProvider[] {
  const exclude = new Set(input.exclude || []);
  let list = [...providers.values()].filter((p) => {
    if (exclude.has(p.id)) return false;
    if (!safeAvailable(p)) return false;
    if (input.needsVideoDriver && !p.supportsVideoDriver) return false;
    return true;
  });
  list = list.sort((a, b) => a.priority - b.priority);
  if (input.prefer) {
    const idx = list.findIndex((p) => p.id === input.prefer);
    if (idx > 0) { const [pick] = list.splice(idx, 1); list.unshift(pick); }
  }
  return list;
}

export interface LipSyncDispatchResult {
  result: LipSyncGenerateResult | null;
  /** 每个尝试过的 provider + 成败,便于 debug。 */
  tried: Array<{ id: string; ok: boolean; error?: string }>;
}

/** 顺序跑选出的链,第一个成功的拿来用;全失败 → result null。 */
export async function dispatchLipSyncGenerate(
  input: LipSyncGenerateInput,
  selection?: LipSyncSelectInput,
): Promise<LipSyncDispatchResult> {
  const chain = selectLipSyncProviders(selection ?? { needsVideoDriver: !!input.faceIsVideo });
  const tried: LipSyncDispatchResult['tried'] = [];
  for (const p of chain) {
    try {
      const result = await p.generate(input);
      if (!result || !/^(https?:|data:video\/)/.test(result.videoUrl || '')) {
        throw new Error('provider 返回的 videoUrl 非法');
      }
      tried.push({ id: p.id, ok: true });
      return { result: { ...result, provider: result.provider || p.id }, tried };
    } catch (e) {
      tried.push({ id: p.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { result: null, tried };
}
