/**
 * v3.2 P2 — TTSProvider registry + dispatcher.
 *
 * 同 image / video registry 一致的契约 — 注册 / 选链 / dispatch.
 * 校验: audioUrl 必须 http(s) 或 data:audio/*.
 */

import type {
  TTSProvider,
  TTSGenerateInput,
  TTSGenerateResult,
  TTSSelectInput,
} from './types';
import { isProviderHealthy, markProviderDownIfFatal } from '../provider-health-cache';

const providers = new Map<string, TTSProvider>();

export function registerTTSProvider(p: TTSProvider): void {
  if (!p || !p.id || typeof p.generate !== 'function') {
    throw new Error('[TTSProviders] register: missing required fields (id / generate)');
  }
  if (typeof p.priority !== 'number') {
    throw new Error(`[TTSProviders] register("${p.id}"): priority must be number`);
  }
  if (typeof p.maxTextLen !== 'number' || p.maxTextLen <= 0) {
    throw new Error(`[TTSProviders] register("${p.id}"): maxTextLen must be positive number`);
  }
  if (!Array.isArray(p.supportedLanguages)) {
    throw new Error(`[TTSProviders] register("${p.id}"): supportedLanguages must be array`);
  }
  if (providers.has(p.id)) {
    console.warn(`[TTSProviders] overriding existing provider "${p.id}"`);
  }
  providers.set(p.id, p);
}

export function clearTTSProviders(): void {
  providers.clear();
}

export function listTTSProviders(): TTSProvider[] {
  return [...providers.values()].sort((a, b) => a.priority - b.priority);
}

export function getTTSProvider(id: string): TTSProvider | undefined {
  return providers.get(id);
}

/** v12.7.0: 是否至少有一个可用 TTS provider(供 orchestrator 判断要不要走配音路径)。 */
export function ttsEngineConfigured(): boolean {
  return [...providers.values()].some((p) => {
    try { return p.available(); } catch { return false; }
  });
}

export function selectProviders(input: TTSSelectInput): TTSProvider[] {
  let chain = listTTSProviders().filter((p) => {
    if (!p.available()) return false;
    if (!isProviderHealthy(p.id)) return false; // v12.8.0: 软熔断 —— 冷却中的 provider 跳过
    if (input.requiresEmotion && !p.supportsEmotion) return false;
    if (input.requiresCloning && !p.supportsCloning) return false;
    if (input.requiresStreaming && !p.supportsStreaming) return false;
    if (input.textLen != null && p.maxTextLen < input.textLen) return false;
    if (input.language && p.supportedLanguages.length > 0 && !p.supportedLanguages.includes(input.language)) {
      return false;
    }
    if (input.exclude && input.exclude.has(p.id)) return false;
    return true;
  });

  if (input.prefer) {
    const idx = chain.findIndex((p) => p.id === input.prefer);
    if (idx > 0) {
      const [hit] = chain.splice(idx, 1);
      chain = [hit, ...chain];
    }
  }
  return chain;
}

export interface TTSDispatchResult {
  result: TTSGenerateResult | null;
  tried: Array<{ id: string; error: string }>;
}

export async function dispatchTTSGenerate(
  input: TTSGenerateInput,
  selection?: TTSSelectInput,
): Promise<TTSDispatchResult> {
  const chain = selectProviders(selection ?? {
    requiresEmotion: !!input.emotion,
    textLen: input.text.length,
    language: input.language,
  });

  const tried: TTSDispatchResult['tried'] = [];
  for (const p of chain) {
    try {
      const r = await p.generate(input);
      if (!r || !r.audioUrl) {
        tried.push({ id: p.id, error: 'empty result' });
        continue;
      }
      const ok = r.audioUrl.startsWith('http') || r.audioUrl.startsWith('data:audio');
      if (!ok) {
        tried.push({ id: p.id, error: `invalid audioUrl: ${r.audioUrl.slice(0, 40)}` });
        continue;
      }
      return { result: r, tried };
    } catch (e) {
      const _msg = e instanceof Error ? e.message : String(e);
      markProviderDownIfFatal(p.id, _msg); // v12.8.0: auth/配额/饱和 → 熔断冷却
      tried.push({ id: p.id, error: _msg });
    }
  }
  return { result: null, tried };
}

export async function autoDiscoverProviders(dir: string): Promise<number> {
  if (typeof window !== 'undefined') {
    console.warn('[TTSProviders] autoDiscoverProviders called in browser — skipping');
    return 0;
  }
  let imported = 0;
  try {
    const { readdirSync, statSync } = await import('fs');
    const { resolve, join } = await import('path');
    const abs = resolve(dir);
    const before = providers.size;
    const entries = readdirSync(abs).filter((f) =>
      /\.(mjs|js|cjs|ts)$/i.test(f) && !f.endsWith('.d.ts'),
    );
    for (const f of entries) {
      const full = join(abs, f);
      if (!statSync(full).isFile()) continue;
      try {
        await import(full);
      } catch (e) {
        console.warn(`[TTSProviders] auto-import failed for ${f}:`, e instanceof Error ? e.message : e);
      }
    }
    imported = providers.size - before;
  } catch (e) {
    console.warn(`[TTSProviders] autoDiscoverProviders("${dir}") failed:`, e instanceof Error ? e.message : e);
  }
  return imported;
}
