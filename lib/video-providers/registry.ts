/**
 * v3.2 P2 — VideoProvider registry + dispatcher.
 *
 * 设计契约和 image-providers/registry.ts 一致, 差异只在 capability filter 更多.
 * 测试: tests/v3-2-video-provider-registry.test.ts.
 */

import type {
  VideoProvider,
  VideoGenerateInput,
  VideoGenerateResult,
  VideoSelectInput,
} from './types';
import { isProviderHealthy, markProviderDownIfFatal } from '../provider-health-cache';

const providers = new Map<string, VideoProvider>();

export function registerVideoProvider(p: VideoProvider): void {
  if (!p || !p.id || typeof p.generate !== 'function') {
    throw new Error('[VideoProviders] register: missing required fields (id / generate)');
  }
  if (typeof p.priority !== 'number') {
    throw new Error(`[VideoProviders] register("${p.id}"): priority must be number`);
  }
  if (typeof p.maxDurationSec !== 'number' || p.maxDurationSec <= 0) {
    throw new Error(`[VideoProviders] register("${p.id}"): maxDurationSec must be positive number`);
  }
  if (providers.has(p.id)) {
    console.warn(`[VideoProviders] overriding existing provider "${p.id}"`);
  }
  providers.set(p.id, p);
}

export function clearVideoProviders(): void {
  providers.clear();
}

export function listVideoProviders(): VideoProvider[] {
  return [...providers.values()].sort((a, b) => a.priority - b.priority);
}

export function getVideoProvider(id: string): VideoProvider | undefined {
  return providers.get(id);
}

/**
 * 按调度规则选 provider 链:
 *   1. available() === true
 *   2. 满足请求的 capability (I2V / T2V / FLF / S2V)
 *   3. maxDurationSec >= request durationSec (有传时)
 *   4. 不在 exclude 集合里
 *   5. 按 priority 升序排序
 *   6. 若 prefer 命中, 把它顶到第 1 位 (其他保持原相对顺序)
 */
export function selectProviders(input: VideoSelectInput): VideoProvider[] {
  const wantI2V = input.hasFirstFrame;
  const wantT2V = !input.hasFirstFrame;
  const wantFLF = input.hasLastFrame;
  const wantS2V = input.hasSubjectReference;
  const want = input.durationSec;

  let chain = listVideoProviders().filter((p) => {
    if (!p.available()) return false;
    if (!isProviderHealthy(p.id)) return false; // v12.8.0: 软熔断 —— 冷却中的 provider 跳过
    if (wantI2V && !p.supportsImage2Video) return false;
    if (wantT2V && !p.supportsText2Video) return false;
    if (wantFLF && !p.supportsLastFrame) return false;
    if (wantS2V && !p.supportsSubjectReference) return false;
    if (want != null && p.maxDurationSec < want) return false;
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

/** dispatch 结果. result 为 null 表示链全 fail. tried 给完整失败日志便于 debug. */
export interface VideoDispatchResult {
  result: VideoGenerateResult | null;
  tried: Array<{ id: string; error: string }>;
}

/**
 * 顺序执行 selectProviders 选出的链, 第一个成功的拿来用.
 * 跨 provider fallback 只在 throw 时触发 — provider 自己返回的 result 必须 imageUrl 合法.
 *
 * 合法 videoUrl 必须以 "http" 或 "data:video" 开头. 任何其他形态 (包括 "<svg>"  / file:// /
 * 空字符串) 都判失败, 跳到下一 provider.
 */
/**
 * v12.63.0 视频瞬时错误判定(纯函数,可测)。
 * 瞬时(值得同 provider 重试一次):引擎侧偶发生成失败(如 `Minimax video-01 error`)、超时、
 * 网络抖动、5xx/过载。**非**瞬时(重试无意义,交给熔断/下家):401/403/402、余额/配额、参数错、
 * 内容审核拒绝、mutually exclusive 等 4xx 语义错误。
 */
export function isTransientVideoError(msg: string): boolean {
  const m = (msg || '').toLowerCase();
  if (/(^|\D)(401|403|402|400|429)(\D|$)/.test(m)) return false; // 鉴权/额度/限流 → 熔断/下家,重试无意义
  if (/invalid[_ ]api[_ ]key|unauthor|forbidden|余额不足|insufficient|quota|配额|exclusive|param|审核|sensitive|policy|no available channel|saturated/i.test(msg)) return false;
  return /video-01 error|minimax-fast error|timeout|timed out|econnreset|socket hang|fetch failed|network|(^|\D)(500|502|504)(\D|$)|internal error|server error/i.test(msg);
}

const VIDEO_TRANSIENT_RETRY_DELAY_MS = 3000;

export async function dispatchVideoGenerate(
  input: VideoGenerateInput,
  selection?: VideoSelectInput,
): Promise<VideoDispatchResult> {
  const chain = selectProviders(selection ?? {
    hasFirstFrame: !!input.firstFrameUrl,
    hasLastFrame: !!input.lastFrameUrl,
    hasSubjectReference: !!(input.subjectReferences && input.subjectReferences.length > 0),
    durationSec: input.durationSec,
  });

  const tried: VideoDispatchResult['tried'] = [];
  for (const p of chain) {
    // v12.63.0:瞬时错误(引擎偶发生成失败/超时/网络/5xx)同 provider 重试 1 次(3s 后)——
    // 此前一败即跳下家甚至掉光,Minimax video-01 error 这类偶发把 10 分镜拖成 3 成片。
    // 非瞬时(鉴权/额度/限流/参数/审核)不重试,交给熔断 + 下家。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await p.generate(input);
        if (!r || !r.videoUrl) {
          tried.push({ id: p.id, error: 'empty result' });
          break; // 空结果非瞬时语义,跳下家
        }
        const ok = r.videoUrl.startsWith('http') || r.videoUrl.startsWith('data:video');
        if (!ok) {
          tried.push({ id: p.id, error: `invalid videoUrl: ${r.videoUrl.slice(0, 40)}` });
          break;
        }
        return { result: r, tried };
      } catch (e) {
        const _msg = e instanceof Error ? e.message : String(e);
        tried.push({ id: p.id, error: _msg });
        if (attempt === 0 && isTransientVideoError(_msg)) {
          console.log(`[VideoDispatch] ${p.id} 瞬时错误,3s 后同引擎重试一次: ${_msg.slice(0, 80)}`);
          await new Promise((res) => setTimeout(res, VIDEO_TRANSIENT_RETRY_DELAY_MS));
          continue;
        }
        markProviderDownIfFatal(p.id, _msg); // v12.8.0: auth/配额/饱和 → 熔断冷却
        break;
      }
    }
  }
  return { result: null, tried };
}

/**
 * 扫一个目录, 把每个 .ts/.mjs/.js/.cjs 文件 dynamic import 一遍.
 * 文件里应该自行调用 registerVideoProvider — 我们只触发副作用.
 *
 * 注意 Next 15 RSC 边界: 这函数只能 server-side 用, 走 require/import 而不是 fetch.
 * 配合 hybrid-orchestrator constructor 末尾 fire-and-forget 即可.
 */
export async function autoDiscoverProviders(dir: string): Promise<number> {
  if (typeof window !== 'undefined') {
    console.warn('[VideoProviders] autoDiscoverProviders called in browser — skipping');
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
        console.warn(`[VideoProviders] auto-import failed for ${f}:`, e instanceof Error ? e.message : e);
      }
    }
    imported = providers.size - before;
  } catch (e) {
    console.warn(`[VideoProviders] autoDiscoverProviders("${dir}") failed:`, e instanceof Error ? e.message : e);
  }
  return imported;
}
