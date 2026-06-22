/**
 * v3.2 P2 — VideoProvider 内置 4 个 adapter:
 *   1. veo            (T2V + I2V + 多参考图)
 *   2. kling          (T2V + I2V + FLF 首尾帧)
 *   3. minimax-video  (T2V + I2V + S2V 多主体)
 *   4. vidu           (I2V 单参考)
 *
 * 设计契约见 image-providers/builtins.ts. 这里只包 adapter, 不动 service 内部.
 */

import { registerVideoProvider } from './registry';
import type { VideoGenerateInput } from './types';
import '@/lib/mock-providers'; // v10.4.0: mock 三件套常驻注册(MOCK_ENGINES=1 才 available)

// ─── Lazy service factories — 启动不预热, 第一次调时实例化 ─────────────────
let veoSvc: any = null;
let klingSvc: any = null;
let minimaxSvc: any = null;
let viduSvc: any = null;

async function getVeo() {
  if (veoSvc) return veoSvc;
  const m = await import('@/services/veo.service');
  if (!(m as any).hasVeo?.()) return null;
  veoSvc = new (m as any).VeoService();
  return veoSvc;
}

async function getKling() {
  if (klingSvc) return klingSvc;
  const m = await import('@/services/kling.service');
  if (!(m as any).hasKling?.()) return null;
  klingSvc = new (m as any).KlingService();
  return klingSvc;
}

async function getMinimax() {
  if (minimaxSvc) return minimaxSvc;
  const m = await import('@/services/minimax.service');
  const hasFn = (m as any).hasMinimax || (() => !!process.env.MINIMAX_API_KEY);
  if (!hasFn()) return null;
  minimaxSvc = new (m as any).MinimaxService();
  return minimaxSvc;
}

async function getVidu() {
  if (viduSvc) return viduSvc;
  const m = await import('@/services/vidu.service');
  if (!process.env.VIDU_API_KEY) return null;
  viduSvc = new (m as any).ViduService();
  return viduSvc;
}

let grokSvc: any = null;
async function getGrok() {
  if (grokSvc) return grokSvc;
  const m = await import('@/services/grok-imagine.service');
  if (!(m as any).hasGrokImagine?.()) return null;
  grokSvc = new (m as any).GrokImagineService();
  return grokSvc;
}

let seedanceSvc: any = null;
async function getSeedance() {
  if (seedanceSvc) return seedanceSvc;
  const m = await import('@/services/seedance.service');
  if (!(m as any).hasSeedance?.()) return null;
  seedanceSvc = new (m as any).SeedanceService();
  return seedanceSvc;
}

let ltxSvc: any = null;
async function getLtx() {
  if (ltxSvc) return ltxSvc;
  const m = await import('@/services/ltx.service');
  if (!(m as any).hasLtx?.()) return null;
  ltxSvc = new (m as any).LtxService();
  return ltxSvc;
}

// ─── Provider 1: Veo ──────────────────────────────────────────────────────
// 优先级 60 — 实测在我们的网关上 Veo 整池稳定性 > Kling > Minimax > Vidu.
// 不支持 FLF (Kling 独有) / 不支持 S2V (Minimax 独有).
registerVideoProvider({
  id: 'veo',
  name: 'Google Veo 3.1 (via qingyuntop)',
  priority: 60,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 10,
  supportsNativeAudio: true, // v12.29.0(P1):Veo 3.1 原生对白音轨
  available: () => {
    try {
      const m = require('@/services/veo.service');
      return m.hasVeo?.() ?? false;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const svc = await getVeo();
    if (!svc) throw new Error('Veo service unavailable');
    const url = await svc.generateVideo(input.firstFrameUrl || '', input.prompt, {
      duration: input.durationSec,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio, // v12.14.0 横竖屏
      style: input.style,
      referenceImages: input.referenceImages,
      onProgress: input.onProgress,
    });
    if (!url) throw new Error('Veo returned empty url');
    return { videoUrl: url, provider: 'veo' };
  },
});

// ─── Provider 2: Kling ────────────────────────────────────────────────────
// 优先级 70 — 通常 Veo 后第二选择. FLF 首尾帧融合是其独家 ability.
registerVideoProvider({
  id: 'kling',
  name: 'Kling v1 / v1-6 (FLF + 4K Master)',
  priority: 70,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: true,        // ← 独家
  supportsSubjectReference: false,
  maxDurationSec: 10,
  supportsNativeAudio: true, // v12.29.0(P1):Kling 3.0 Omni 跨镜音画同步
  available: () => {
    try {
      const m = require('@/services/kling.service');
      return m.hasKling?.() ?? false;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const svc = await getKling();
    if (!svc) throw new Error('Kling service unavailable');
    // 首尾帧融合走 FLF 通道
    if (input.firstFrameUrl && input.lastFrameUrl) {
      const url = await svc.generateFirstLastFrame(
        input.firstFrameUrl,
        input.lastFrameUrl,
        input.prompt,
        {
          duration: input.durationSec,
          mode: input.mode || 'standard',
          onProgress: input.onProgress,
        },
      );
      if (!url) throw new Error('Kling FLF returned empty url');
      return { videoUrl: url, provider: 'kling-flf' };
    }
    // 普通 I2V / T2V
    const url = await svc.generateVideo(input.firstFrameUrl || '', input.prompt, {
      duration: input.durationSec,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio, // v12.14.0 横竖屏
      mode: input.mode || 'standard',
      onProgress: input.onProgress,
    });
    if (!url) throw new Error('Kling returned empty url');
    return { videoUrl: url, provider: 'kling' };
  },
});

// ─── Provider 3: Minimax 视频 (Hailuo-2.3 / S2V-01) ────────────────────────
// 优先级 80 — S2V-01 多主体一致性是其独家 ability.
registerVideoProvider({
  id: 'minimax-video',
  name: 'Minimax Hailuo-2.3 / S2V-01 (subject reference)',
  priority: 80,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: true,  // ← 独家
  maxDurationSec: 10,
  available: () => {
    try {
      const m = require('@/services/minimax.service');
      const has = m.hasMinimax?.() ?? !!process.env.MINIMAX_API_KEY;
      return has;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const svc = await getMinimax();
    if (!svc) throw new Error('Minimax service unavailable');
    const url = await svc.generateVideo(input.firstFrameUrl || '', input.prompt, {
      duration: input.durationSec,
      aspectRatio: input.aspectRatio, // v12.14.0 横竖屏
      subjectReferences: input.subjectReferences,
      referenceImages: input.referenceImages,
    });
    if (!url) throw new Error('Minimax video returned empty url');
    return { videoUrl: url, provider: 'minimax-video' };
  },
});

// ─── Provider 4: Vidu ─────────────────────────────────────────────────────
// 优先级 90 — I2V only, T2V 不支持. 用作 Veo/Kling/Minimax 都跪了的最后兜底.
registerVideoProvider({
  id: 'vidu',
  name: 'Vidu (I2V only)',
  priority: 90,
  supportsImage2Video: true,
  supportsText2Video: false,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 8,
  available: () => !!process.env.VIDU_API_KEY,
  async generate(input: VideoGenerateInput) {
    if (!input.firstFrameUrl) throw new Error('Vidu requires firstFrameUrl (I2V only)');
    const svc = await getVidu();
    if (!svc) throw new Error('Vidu service unavailable');
    const url = await svc.generateVideo(input.firstFrameUrl, input.prompt, {
      duration: input.durationSec,
      style: input.style,
    });
    if (!url) throw new Error('Vidu returned empty url');
    return { videoUrl: url, provider: 'vidu' };
  },
});

// ─── Provider 5: Grok Imagine 1.5 (xAI) ──────────────────────────────────
// 优先级 55 — 2026-06 起图生视频盲投榜首(原生音频 + 极速 + 低价)。BYO:
// GROK_API_KEY 配了才 available() → 顶到 Veo(60)前作主选;失败由 registry 自动跳下一引擎。
// 诚实:本环境无 key 未真验,请求体/轮询解析有单测;成片自带原生音频(取用留给 P1)。
registerVideoProvider({
  id: 'grok-imagine',
  name: 'xAI Grok Imagine 1.5 (T2V + I2V, native audio)',
  priority: 55,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 15,
  supportsNativeAudio: true, // v12.29.0(P1):Grok 成片自带原生音频
  available: () => {
    try {
      const m = require('@/services/grok-imagine.service');
      return m.hasGrokImagine?.() ?? false;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const svc = await getGrok();
    if (!svc) throw new Error('Grok Imagine service unavailable');
    // v12.29.0(P1):native 模式把要念的台词拼进 prompt(仅原生引擎可见)
    const prompt = input.nativeAudio && input.spokenDialogue
      ? `${input.prompt}. Spoken line (voice this aloud): "${input.spokenDialogue}"`
      : input.prompt;
    const url = await svc.generateVideo(input.firstFrameUrl || '', prompt, {
      duration: input.durationSec,
      aspectRatio: input.aspectRatio,
      referenceImages: input.referenceImages,
      nativeAudio: input.nativeAudio,
      onProgress: input.onProgress,
    });
    if (!url) throw new Error('Grok Imagine returned empty url');
    return { videoUrl: url, provider: 'grok-imagine' };
  },
});

// ─── Provider 6: ByteDance Seedance 2.0 (火山引擎 CV) ─────────────────────
// 优先级 58 — 2026-06 文生视频盲投第三、原生多镜 + 音画一体;多图参考(角色图最前)即主体锁定。
// BYO:JIMENG_AK/JIMENG_SK 配了才 available();失败由 registry 跳下一引擎。
// 诚实:nativeAudio 暂不开(主管线仍 TTS+对唇形,避免双音轨;原生音画取用留 P1)。
registerVideoProvider({
  id: 'seedance',
  name: 'ByteDance Seedance 2.0 (multi-ref + native A/V)',
  priority: 58,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: true,   // 多图参考(角色图最前)= 主体锁定
  maxDurationSec: 15,
  supportsNativeAudio: true, // v12.29.0(P1):Seedance 2.0 原生音画一体(av 模式)
  available: () => {
    try {
      const m = require('@/services/seedance.service');
      return m.hasSeedance?.() ?? false;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const svc = await getSeedance();
    if (!svc) throw new Error('Seedance service unavailable');
    const m = await import('@/services/seedance.service');
    const opts = (m as any).buildSeedanceOptionsFromInput(input);
    const r = await svc.generateVideo(opts);
    if (!r || r.status !== 'success' || !r.videoUrl) {
      throw new Error(`Seedance failed: ${r?.error || 'no url'}`);
    }
    input.onProgress?.(1, 'seedance: done');
    return { videoUrl: r.videoUrl, provider: 'seedance', upstreamId: r.taskId };
  },
});

// ─── Provider 7: LTX-2.3 (Lightricks, 开源/可自托管) ──────────────────────
// 优先级 62 — 2026-06 文生视频盲投次席、开源权重最强;补「全链自托管」拼图(LTX_BASE_URL 可指自托管)。
// BYO:LTX_API_KEY(或 FAL_KEY)配了才 available();失败由 registry 跳下一引擎。成片自带原生音频(取用留 P1)。
registerVideoProvider({
  id: 'ltx',
  name: 'LTX-2.3 (Lightricks open-weight, self-hostable)',
  priority: 62,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 20,
  supportsNativeAudio: true, // v12.29.0(P1):LTX-2 音画一体
  available: () => {
    try {
      const m = require('@/services/ltx.service');
      return m.hasLtx?.() ?? false;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const svc = await getLtx();
    if (!svc) throw new Error('LTX service unavailable');
    const prompt = input.nativeAudio && input.spokenDialogue
      ? `${input.prompt}. Spoken line (voice this aloud): "${input.spokenDialogue}"`
      : input.prompt;
    const url = await svc.generateVideo(input.firstFrameUrl || '', prompt, {
      duration: input.durationSec,
      aspectRatio: input.aspectRatio,
      nativeAudio: input.nativeAudio,
      onProgress: input.onProgress,
    });
    if (!url) throw new Error('LTX returned empty url');
    return { videoUrl: url, provider: 'ltx' };
  },
});

console.log('[VideoProviders] 7 built-ins registered (grok-imagine / seedance / veo / ltx / kling / minimax-video / vidu)');
