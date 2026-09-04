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

async function getVidu(): Promise<import('@/services/vidu.service').ViduService | null> {
  if (viduSvc) return viduSvc;
  const m = await import('@/services/vidu.service');
  if (!process.env.VIDU_API_KEY) return null;
  // v12.403:此前这里 `new (m as any).ViduService()`,返回值也是 any ——
  // 于是下面给它传了个官方根本没有的 `style` 字段,tsc 一声不吭。
  // any 会把契约整个抹掉,而抹掉契约的地方正是「传了不生效」最容易发生的地方。
  viduSvc = new m.ViduService();
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
  // v12.422:**此前写 10,而 Veo 3.1 单次上限严格是 8s**(官方 duration 枚举只有 4/6/8;
  // 4K 更锁死 8s)。60s+ 那个数字是 Scene Extension 续接出来的,不是单次能力 ——
  // 我们在 v12.401 的 README 上把这两者混淆过一次,这里是同一个混淆的**代码版**。
  //
  // 以前无所谓:所有请求都写死 8s,虚报的那 2 秒永远不会被行使。
  // 本版把请求改成「剧本写多长就要多长」之后,虚报立刻变成**选错引擎**:
  // 要 10s 时 Veo 仍会被选中,然后交回一个 8s 的片子,而没有任何一处会说它短了。
  maxDurationSec: 8,
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
  name: 'Kling v1 / v1-6 (FLF + 4K Master + Elements)',
  priority: 70,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: true,        // ← 独家
  // v12.78.0:KLING_ELEMENTS=1 时支持多参考图跨镜锁定(Elements,一致性 SOTA 路线);
  // getter 动态求值 —— dispatch 的 hasSubjectReference 过滤在开关开启时不再把 kling 踢出链。
  get supportsSubjectReference() { return process.env.KLING_ELEMENTS === '1'; },
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
    // 普通 I2V / T2V(v12.78.0:透传 subjectReferences/referenceImages —— service 层 Elements
    // v12.15 已实现但 provider 一直没传,dispatch 到不了;KLING_ELEMENTS=1 时生效)
    const url = await svc.generateVideo(input.firstFrameUrl || '', input.prompt, {
      duration: input.durationSec,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio, // v12.14.0 横竖屏
      mode: input.mode || 'standard',
      subjectReferences: input.subjectReferences,
      referenceImages: input.referenceImages,
      onProgress: input.onProgress,
    });
    if (!url) throw new Error('Kling returned empty url');
    return { videoUrl: url, provider: 'kling' };
  },
});

// ─── Provider 2.5: Vidu Q3(经 qingyuntop 网关,v12.104)─────────────────────
// 优先级 75(kling 70 之后、minimax 80 之前):veo 死/minimax 慢时的新 AI 视频通道。
// Vidu 官方 /ent/v2 形态,复用 OPENAI_API_KEY;QYT_VIDU_DISABLE=1 可关。
registerVideoProvider({
  id: 'qyt-vidu',
  name: 'Vidu Q3 (via qingyuntop /ent/v2)',
  priority: 75,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 8,
  available: () => {
    try {
      const m = require('@/services/qyt-vidu.service');
      return m.hasQytVidu?.() ?? false;
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const { QytViduService } = await import('@/services/qyt-vidu.service');
    const url = await new QytViduService().generateVideo(input.firstFrameUrl || '', input.prompt, {
      duration: input.durationSec,
      aspectRatio: input.aspectRatio,
    });
    if (!url) throw new Error('QytVidu returned empty url');
    return { videoUrl: url, provider: 'qyt-vidu' };
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

// ─── Provider 0: 自托管开源端点 ────────────────────────────────────────────
// v12.411:本轮竞品复核**推翻了上一轮的 C2**(「开源侧进不了第一梯队」)——
// Wan 2.7(Apache 2.0,1080p/15s/原生音频,RTX 4090 可跑)与 LTX-2.5
// (宽松商业许可,16GB 显存,AA 榜 I2V 第 3 / T2V 第 4,高于闭源 Sora 2 Pro)
// 都已进入第一梯队。而此前这张注册表**全是闭源商业 API** ——
// 一个主打「MIT 开源、可自托管」的项目,用户能自托管应用,却必须为每一帧
// 向别人付费并承担别人的停服风险。停服不是假设:MiniMax Music 停过(v12.410),
// Seedance 2.0 海外 API 因好莱坞版权停止函中止过(2026-03,至今未和解)。
//
// 优先级刻意排在**最前**(数字最小):自托管零边际成本,配了就该优先用;
// 没配 SELFHOST_VIDEO_URL 时 available() 为 false,整条链行为与此前完全一致(零回归)。
registerVideoProvider({
  id: 'selfhost',
  name: '自托管开源端点(Wan / LTX 等)',
  priority: 10,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  // Wan 2.7 官方 1080p 最长 15s;自建服务可用 SELFHOST_VIDEO_MAX_SEC 覆盖
  maxDurationSec: Number(process.env.SELFHOST_VIDEO_MAX_SEC) || 15,
  available: () => {
    try {
      // 用 require 而非顶层 import:未配置时不该把这个模块也加载进来
      const m = require('@/services/selfhost-video.service');
      return !!m.hasSelfhostVideo?.();
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const { SelfhostVideoService } = await import('@/services/selfhost-video.service');
    const svc = new SelfhostVideoService();
    const url = await svc.generateVideo(input.prompt, {
      imageUrl: input.firstFrameUrl,
      durationSec: input.durationSec,
      aspectRatio: input.aspectRatio,
    });
    if (!url) throw new Error('自托管端点返回空 url');
    // 带上实际模型 —— 决策日志要能复盘是哪一版权重出的片
    return { videoUrl: url, provider: 'selfhost', model: svc.lastModel };
  },
});

// ─── Provider: Wan 3.0(30s 原生单镜)────────────────────────────────────
// v12.422:全链此前最长 20s(而那 20s 还是虚报的,实际 10s)。Wan 3.0 是目前
// **唯一无版权纠纷的 30s 原生单次**路径 —— 30 秒是一次 API 调用直出的连续片段,
// 不是 Scene Extension 那种续接拼出来的(经多源独立复核确认)。
//
// 优先级 85:排在常规引擎**之后**。它每秒 ¥1.2(1080P),一条 30s ≈ ¥36,
// 是注册表里最贵的;只在剧本真要长镜、别家 maxDurationSec 都够不着时才轮到它。
// 不配 WAN_API_KEY 时 available() 为 false,整条链行为与此前完全一致(零回归)。
registerVideoProvider({
  id: 'wan',
  name: 'Wan 3.0(阿里 · 30s 原生单镜)',
  priority: 85,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  supportsNativeAudio: true, // 官方 parameters.audio 默认 true
  maxDurationSec: 30,
  available: () => {
    try {
      const m = require('@/services/wan.service');
      return !!m.hasWan?.();
    } catch { return false; }
  },
  async generate(input: VideoGenerateInput) {
    const { WanService } = await import('@/services/wan.service');
    const svc = new WanService();
    const url = await svc.generateVideo(input.prompt, {
      imageUrl: input.firstFrameUrl,
      durationSec: input.durationSec,
      aspectRatio: input.aspectRatio,
    });
    if (!url) throw new Error('Wan 返回空 url');
    // 带上实际模型 —— 决策日志要能复盘是哪一档出的片(标准档 vs prime 差价明显)
    return { videoUrl: url, provider: 'wan', model: svc.lastModel };
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
  // v12.403:Q3 官方支持 1–16s(此前写死 8,把 Q3 的长镜能力挡在门外)
  maxDurationSec: 16,
  available: () => !!process.env.VIDU_API_KEY,
  async generate(input: VideoGenerateInput) {
    if (!input.firstFrameUrl) throw new Error('Vidu requires firstFrameUrl (I2V only)');
    const svc = await getVidu();
    if (!svc) throw new Error('Vidu service unavailable');
    const url = await svc.generateVideo(input.firstFrameUrl, input.prompt, {
      duration: input.durationSec,
    });
    if (!url) throw new Error('Vidu returned empty url');
    // provider 里带上**实际发出的模型**,决策日志才有复盘价值
    return { videoUrl: url, provider: 'vidu', model: svc.lastModel };
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
  // v12.422:**此前写 20,而我们钉的端点做不到 20**。
  // `LTX_MODEL` 默认 `fal-ai/ltx-2.3/text-to-video` 是 **Pro 变体**,
  // duration 枚举只有 6/8/10 —— 单次上限 **10s**。20s 属于我们没钉的 `/fast` 变体
  //(且 >10s 还要求 25fps + 1080p)。经三条独立复核确认。
  //
  // 所以这里跟着**实际钉住的端点**走。想要 20s 就把 LTX_MODEL 显式切到 /fast 变体、
  // 同时调 LTX_MAX_SEC —— 让「用哪个端点」和「声称能做多长」必须一起改,
  // 而不是让注册表替一个它没在调的端点说大话。
  maxDurationSec: Number(process.env.LTX_MAX_SEC) || 10,
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

// v12.120:动态计数(v12.104 加 qyt-vidu 时这行忘了更新,监控日志误导排障)
import { listVideoProviders } from './registry';
const _ids = listVideoProviders().filter((p) => p.id !== 'mock-video').map((p) => p.id);
if (process.env.NODE_ENV !== 'test') console.log(`[VideoProviders] ${_ids.length} built-ins registered (${_ids.join(' / ')})`);
