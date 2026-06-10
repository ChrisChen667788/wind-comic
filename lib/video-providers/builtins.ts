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

// ─── Provider 1: Veo ──────────────────────────────────────────────────────
// 优先级 60 — 实测在我们的网关上 Veo 整池稳定性 > Kling > Minimax > Vidu.
// 不支持 FLF (Kling 独有) / 不支持 S2V (Minimax 独有).
registerVideoProvider({
  id: 'veo',
  name: 'Google Veo 3.1 / Sora-2 (via qingyuntop)',
  priority: 60,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 10,
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

console.log('[VideoProviders] 4 built-ins registered (veo / kling / minimax-video / vidu)');
