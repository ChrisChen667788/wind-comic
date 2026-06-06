/**
 * lib/lipsync-providers/builtins (v9.6.9) — 内置口型引擎适配器(env 门控,导入即注册)。
 *
 * `wav2lip-http`:通用「自托管 HTTP 口型服务」适配器 —— 把任意 wav2lip / SadTalker / MuseTalk
 * 包一层 HTTP(POST {faceUrl, audioUrl, visemes} → {videoUrl})即可接入。env 门控:
 *   LIPSYNC_API_URL  — 服务地址(配了才 available)
 *   LIPSYNC_API_KEY  — 可选 Bearer 鉴权
 * 不配 → 不可用(registry 自然跳过,UI 显示「引擎未配置」)。密钥只走 env,绝不入库 / 不打印。
 */
import { registerLipSyncProvider } from './registry';
import type { LipSyncProvider } from './types';

const httpProvider: LipSyncProvider = {
  id: 'wav2lip-http',
  name: '自托管口型引擎 (HTTP · wav2lip/SadTalker/MuseTalk)',
  priority: 50,
  supportsVideoDriver: true,
  available: () => !!process.env.LIPSYNC_API_URL,
  async generate(input) {
    const url = process.env.LIPSYNC_API_URL;
    if (!url) throw new Error('LIPSYNC_API_URL 未配置');
    if (!input.faceUrl || !input.audioUrl) throw new Error('缺 faceUrl / audioUrl');
    input.onProgress?.(5, '提交口型渲染…');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LIPSYNC_API_KEY ? { Authorization: `Bearer ${process.env.LIPSYNC_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        faceUrl: input.faceUrl, audioUrl: input.audioUrl,
        visemes: input.visemes ?? null, faceIsVideo: !!input.faceIsVideo,
      }),
    });
    if (!res.ok) throw new Error(`口型引擎 HTTP ${res.status}`);
    const body = (await res.json()) as { videoUrl?: string; durationSec?: number; upstreamId?: string; estCostCny?: number };
    if (!body?.videoUrl) throw new Error('口型引擎未返回 videoUrl');
    input.onProgress?.(100, '完成');
    return {
      videoUrl: body.videoUrl, provider: 'wav2lip-http',
      durationSec: body.durationSec, upstreamId: body.upstreamId, estCostCny: body.estCostCny,
    };
  },
};

registerLipSyncProvider(httpProvider);
