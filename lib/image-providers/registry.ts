/**
 * v3.2 P1 — Image Provider 注册表.
 *
 * 模块加载时调用 registerImageProvider() 注册. 调用方 selectProviders(input)
 * 拿一个排好序的 chain 试 (orchestrator 会按顺序 fallback).
 *
 * 这个模块本身不依赖 orchestrator — 纯 lib, 可单独测.
 *
 * 与现有 image-router.ts 共存:
 *   - 内置 4 个 engine (mj/minimax-multi/minimax-single/kontext) 仍走 image-router
 *   - 任何自定义 provider 经此注册表加入 chain, 作内置之后的额外 fallback
 *   - 用户也可注册替换内置 (priority < 100), 让自定义 provider 优先
 */

import type { ImageProvider, SelectInput, ImageGenerateInput, ImageGenerateResult } from './types';
import { isProviderHealthy, markProviderDownIfFatal } from '../provider-health-cache';

const providers = new Map<string, ImageProvider>();

/**
 * 注册一个 provider. 同 id 重复注册 = 覆盖 (允许 reload).
 */
export function registerImageProvider(p: ImageProvider): void {
  if (!p.id || !p.generate) throw new Error('provider must have id + generate()');
  providers.set(p.id, p);
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[ImageProviders] registered ${p.id} (${p.name}, priority=${p.priority}, refs<=${p.maxRefImages})`);
  }
}

/**
 * 清空注册表 — 测试 / 热重载用. 慎在生产环境调.
 */
export function clearImageProviders(): void {
  providers.clear();
}

/**
 * 列出所有已注册的 provider (按 priority 升序).
 */
export function listImageProviders(): ImageProvider[] {
  return Array.from(providers.values()).sort((a, b) => a.priority - b.priority);
}

/**
 * 给一个调用场景选合适的 provider chain.
 * 规则:
 *   1. available() === false → 排除
 *   2. refCount > maxRefImages → 排除 (它吃不下这么多 ref)
 *   2b. refCount < minRefImages → 排除 (它吃不了这么少 ref —— v12.371)
 *   3. exclude 里的 → 排除
 *   4. prefer 命中 → 提到第一位
 *   5. 其余按 priority 升序
 */
export function selectProviders(input: SelectInput): ImageProvider[] {
  const all = Array.from(providers.values());
  const filtered = all.filter((p) => {
    if (input.exclude?.has(p.id)) return false;
    if (!p.available()) return false;
    if (!isProviderHealthy(p.id)) return false; // v12.8.0: 软熔断 —— 冷却中的 provider 跳过
    if (input.refCount > p.maxRefImages) return false;
    // v12.371:下界。少了它,0 参考图的场景生成会先白试一次 multi-ref 再必然失败。
    if (input.refCount < (p.minRefImages ?? 0)) return false;
    return true;
  });
  filtered.sort((a, b) => a.priority - b.priority);
  if (input.prefer) {
    const idx = filtered.findIndex((p) => p.id === input.prefer);
    if (idx > 0) {
      const [hit] = filtered.splice(idx, 1);
      filtered.unshift(hit);
    }
  }
  return filtered;
}

/**
 * 完整调度: 拿 chain 顺序 try 每一个, 第 1 个成功就返回.
 * 失败时返 null + 记录每个 provider 的错 (调用方再 fallback 到老 image-router).
 */
export async function dispatchImageGenerate(
  input: ImageGenerateInput,
  selection: SelectInput,
): Promise<{ result: ImageGenerateResult | null; tried: Array<{ id: string; error: string }> }> {
  const chain = selectProviders(selection);
  const tried: Array<{ id: string; error: string }> = [];
  for (const p of chain) {
    try {
      const r = await p.generate(input);
      if (r && r.imageUrl && (r.imageUrl.startsWith('http') || r.imageUrl.startsWith('data:'))) {
        return { result: r, tried };
      }
      tried.push({ id: p.id, error: 'provider returned empty/invalid imageUrl' });
    } catch (e) {
      const _msg = e instanceof Error ? e.message : String(e);
      markProviderDownIfFatal(p.id, _msg); // v12.8.0: auth/配额/饱和 → 熔断冷却
      tried.push({ id: p.id, error: _msg });
    }
  }

  // ── v12.397:主轮全失败后,允许「丢掉参考图」再试一轮 ────────────────────
  //
  // owner 的重跑日志里,场景图三个 provider 全挂:
  //   Minimax multi-ref needs at least 1 ref | flux-2-pro 401 Token quota exhausted | MJ submit failed
  // 而第四个 provider `minimax-single`(纯 T2I)**一次都没被试过** ——
  // 它的 `maxRefImages: 0`,而 selectProviders 判「refCount > maxRefImages → 排除」,
  // 于是只要传了任何参考图(哪怕只是风格锚),它就永远出不了场。
  //
  // 结果是「宁可一张图都没有,也不肯出一张没有风格锚的图」。
  // 而对场景图来说参考图是**加分项**不是必需品:有当然更好,
  // 没有也总比整个项目卡在这里强。
  //
  // 两条边界:
  //   · 只在**主轮全失败**之后才走,不抢正常路径,也不改变正常情况下的选路顺序;
  //   · **必须如实标注 refsIgnored** —— 静默降级正是这一系列一直在消灭的东西,
  //     调用方得知道这张图为什么和同项目的其它图不一致。
  if (selection.refCount > 0) {
    const noRefChain = selectProviders({ ...selection, refCount: 0 }).filter(
      (p) => !chain.some((c) => c.id === p.id),
    );
    for (const p of noRefChain) {
      try {
        const r = await p.generate({ ...input, referenceImages: [], cref: undefined, sref: undefined });
        if (r && r.imageUrl && (r.imageUrl.startsWith('http') || r.imageUrl.startsWith('data:'))) {
          console.warn(`[ImageProviders] 主轮全失败,已用 ${p.id} 无参考图出图 —— 这张没有风格锚`);
          return { result: { ...r, refsIgnored: true }, tried };
        }
        tried.push({ id: `${p.id}(no-ref)`, error: 'provider returned empty/invalid imageUrl' });
      } catch (e) {
        const _msg = e instanceof Error ? e.message : String(e);
        markProviderDownIfFatal(p.id, _msg);
        tried.push({ id: `${p.id}(no-ref)`, error: _msg });
      }
    }
  }

  return { result: null, tried };
}

/**
 * Optional auto-discover — 扫某目录下所有 .mjs/.ts 文件, dynamic import 触发副作用.
 * 用户可设 IMAGE_PROVIDERS_DIR=./custom-image-providers/, orchestrator 启动时调一次.
 *
 * 不在 client / browser bundle 跑 — 需要 fs/path. 调用方负责 SSR/server-only.
 */
export async function autoDiscoverProviders(dir: string): Promise<number> {
  if (typeof window !== 'undefined') return 0;
  const fs = await import('fs');
  const path = await import('path');
  const url = await import('url');
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => /\.(mjs|js|cjs)$/.test(f));
  let loaded = 0;
  for (const f of files) {
    try {
      const abs = path.resolve(dir, f);
      // dynamic import — 在 ESM 环境用 file:// URL
      const fileUrl = url.pathToFileURL(abs).href;
      await import(fileUrl);
      loaded++;
    } catch (e) {
      console.warn(`[ImageProviders] auto-discover failed for ${f}:`, e instanceof Error ? e.message : e);
    }
  }
  return loaded;
}
