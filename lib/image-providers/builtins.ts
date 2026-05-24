/**
 * v3.2 P1 — 把内置 4 个引擎 (MJ / Minimax / Flux) 也走 plugin registry.
 *
 * 这样:
 *   - orchestrator 的逻辑变成单一: 从 registry 选 chain → 顺序 try.
 *   - 用户加自定义 provider 跟内置无区别, 优先级数字决定谁先跑.
 *   - 内置仍然用 service class (MidjourneyService 等) — 我们只是给它包了个 adapter.
 *
 * 调用方在 orchestrator 启动时 import 此模块一次, 副作用即注册.
 */

import { registerImageProvider } from './registry';
import type { ImageGenerateInput } from './types';

// ─── Lazy service factory — 避免 server 启动就加载所有 service ────────────
// 因为 service class 在 constructor 里读 API_CONFIG (.env), 这里用 lazy + 缓存
let mjSvc: any = null;
let minimaxSvc: any = null;

async function getMjService() {
  if (mjSvc) return mjSvc;
  const m = await import('@/services/midjourney.service');
  if (!(m as any).hasMidjourney()) return null;
  mjSvc = new (m as any).MidjourneyService();
  return mjSvc;
}

async function getMinimaxService() {
  if (minimaxSvc) return minimaxSvc;
  const m = await import('@/services/minimax.service');
  // hasMinimax 工厂函数判断 key 是否存在
  const hasFn = (m as any).hasMinimax || (() => !!process.env.MINIMAX_API_KEY);
  if (!hasFn()) return null;
  minimaxSvc = new (m as any).MinimaxService();
  return minimaxSvc;
}

// ─── Provider 1: Midjourney ────────────────────────────────────────────────
registerImageProvider({
  id: 'mj',
  name: 'Midjourney (via gateway)',
  supportsRefs: true,
  maxRefImages: 2,   // MJ 实际只吃 --cref + --sref = 2
  priority: 100,
  available: () => {
    try {
      const m = require('@/services/midjourney.service');
      return m.hasMidjourney?.() ?? false;
    } catch { return false; }
  },
  async generate(input: ImageGenerateInput) {
    const svc = await getMjService();
    if (!svc) throw new Error('MJ service unavailable');
    const url = await svc.generateImage(input.prompt, {
      aspectRatio: input.aspectRatio,
      cref: input.cref,
      sref: input.sref,
      cw: input.cw ?? 100,
    });
    if (!url || url.startsWith('data:')) throw new Error('MJ returned mock');
    return { imageUrl: url, provider: 'mj' };
  },
});

// ─── Provider 2: Minimax multi-ref ────────────────────────────────────────
registerImageProvider({
  id: 'minimax-multi',
  name: 'Minimax image-01 (multi-ref)',
  supportsRefs: true,
  maxRefImages: 4,
  priority: 90,   // ref ≥ 3 时比 MJ 更适合 — 优先级稍高
  available: () => {
    try {
      const m = require('@/services/minimax.service');
      const has = m.hasMinimax?.() ?? !!process.env.MINIMAX_API_KEY;
      return has;
    } catch { return false; }
  },
  async generate(input: ImageGenerateInput) {
    const svc = await getMinimaxService();
    if (!svc) throw new Error('Minimax service unavailable');
    const refs = [
      ...(input.referenceImages || []),
      ...(input.cref ? [input.cref] : []),
      ...(input.sref ? [input.sref] : []),
    ].filter((u) => u && u.startsWith('http'));
    const dedupedRefs = Array.from(new Set(refs)).slice(0, 4);
    if (dedupedRefs.length === 0) throw new Error('Minimax multi-ref needs at least 1 ref');
    const url = await svc.generateImageWithRefs(input.prompt, dedupedRefs, {
      aspectRatio: input.aspectRatio || '16:9',
    });
    if (!url || url.startsWith('data:')) throw new Error('Minimax returned mock');
    return { imageUrl: url, provider: 'minimax-multi' };
  },
});

// ─── Provider 3: Minimax single (no refs) ─────────────────────────────────
registerImageProvider({
  id: 'minimax-single',
  name: 'Minimax image-01 (T2I)',
  supportsRefs: false,
  maxRefImages: 0,
  priority: 120,
  available: () => {
    try {
      const m = require('@/services/minimax.service');
      const has = m.hasMinimax?.() ?? !!process.env.MINIMAX_API_KEY;
      return has;
    } catch { return false; }
  },
  async generate(input: ImageGenerateInput) {
    const svc = await getMinimaxService();
    if (!svc) throw new Error('Minimax service unavailable');
    const url = await svc.generateImage(input.prompt, {
      aspectRatio: input.aspectRatio || '16:9',
    });
    if (!url || url.startsWith('data:')) throw new Error('Minimax returned mock');
    return { imageUrl: url, provider: 'minimax-single' };
  },
});

// ─── Provider 4: flux.1-kontext-pro (via OpenAI-compat gateway) ──────────
registerImageProvider({
  id: 'kontext',
  name: 'Strong image (IMAGE_MODEL, e.g. flux-2-pro · gateway)',
  supportsRefs: true,
  maxRefImages: 4,
  priority: 110,
  available: () => !!process.env.QINGYUNTOP_API_KEY || !!process.env.VEO_API_KEY || !!process.env.OPENAI_API_KEY,
  async generate(input: ImageGenerateInput) {
    // v6.8: 走 OpenAI 兼容 /v1/images/generations 的最强图像模型 (IMAGE_MODEL, 默认 flux.1-kontext-pro).
    // key 与 base 必须配对 (之前 OPENAI_API_KEY 被假定=vectorengine, 现已可指向 qingyuntop → 修正).
    const key = process.env.QINGYUNTOP_API_KEY || process.env.VEO_API_KEY || process.env.OPENAI_API_KEY;
    const base = process.env.QINGYUNTOP_API_KEY
      ? (process.env.QINGYUNTOP_BASE_URL || 'https://api.qingyuntop.top')
      : process.env.VEO_API_KEY
        ? (process.env.VEO_BASE_URL || 'https://api.vectorengine.ai')
        : 'https://api.vectorengine.ai';
    const model = process.env.IMAGE_MODEL || 'flux.1-kontext-pro';
    if (!key) throw new Error('no image gateway key');
    const refUrls = [
      ...(input.referenceImages || []),
      ...(input.cref ? [input.cref] : []),
      ...(input.sref ? [input.sref] : []),
    ].filter((u) => u && u.startsWith('http')).slice(0, 4);
    const refHint = refUrls.length > 0 ? ` [Reference images: ${refUrls.join(' , ')}]` : '';
    const res = await fetch(`${base}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: input.prompt + refHint,
        n: 1,
        size: '1024x1024',
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      throw new Error(`image(${model}) ${res.status}: ${(await res.text()).slice(0, 100)}`);
    }
    const json = await res.json();
    if (json.data?.[0]?.url) return { imageUrl: json.data[0].url, provider: 'kontext' };
    if (json.data?.[0]?.b64_json) {
      return { imageUrl: `data:image/png;base64,${json.data[0].b64_json}`, provider: 'kontext' };
    }
    throw new Error('kontext returned no image');
  },
});

console.log('[ImageProviders] 4 built-ins registered (mj / minimax-multi / minimax-single / kontext)');
