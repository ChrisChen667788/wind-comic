import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { MidjourneyService, hasMidjourney } from '@/services/midjourney.service';
import { MinimaxService } from '@/services/minimax.service';
import { API_CONFIG } from '@/lib/config';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * v12.59.0 — 视频引擎「同首帧对比」工具(veo vs minimax vs kling)。
 * 出图一次(共享首帧,隔离变量)→ 每个引擎在同一首帧上各生成一遍 → persistAsset 落 serve-file
 * (dev server 可达上游 CDN,产物变本地 serve URL,便于取回/展示)。仿真人 prompt 内联(禁 3D/CGI)。
 * POST { idea, style?, aspect?, providers?: ['veo','minimax','kling'] }
 */
export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const idea: string = (body?.idea || '').trim();
  const style: string = (body?.style || 'cinematic commercial').toString().slice(0, 80);
  const aspect: string = ['9:16', '16:9', '1:1'].includes(body?.aspect) ? body.aspect : '9:16';
  const providers: string[] = Array.isArray(body?.providers) && body.providers.length
    ? body.providers.filter((p: string) => ['veo', 'minimax', 'kling'].includes(p))
    : ['veo', 'minimax'];
  if (idea.length < 10) return NextResponse.json({ message: 'idea 至少 10 字' }, { status: 400 });
  if (!hasMidjourney()) return NextResponse.json({ message: 'MJ 未配置(出图依赖)' }, { status: 422 });

  // 仿真人硬 prompt(禁 3D/CGI/octane)
  const visualPrompt =
    `${idea}. ${style}, vertical ${aspect}. photorealistic, shot on ARRI/RED cinema camera, ` +
    `real human skin with visible pores and fine hair, natural film grain, true-to-life lighting, ` +
    `ultra-detailed, advertising photography. NO 3d render, NO CGI, NO cartoon, NO anime, NO octane render, NO illustration.`;
  const motionPrompt =
    `${visualPrompt}\n\nCamera: subtle slow push-in, smooth ease-in-out. ` +
    `Maintain photographic realism, preserve lighting/color of the input image. Avoid morphing, face distortion, hand mutation.`;

  // ── 出图一次(共享首帧)──
  let imageUrl = '';
  try {
    imageUrl = await new MidjourneyService().generateImage(visualPrompt, { aspectRatio: aspect, skipUpscale: true });
    if (!imageUrl) throw new Error('MJ 空 imageUrl');
  } catch (e) {
    return NextResponse.json({ message: `出图失败: ${e instanceof Error ? e.message : e}`.slice(0, 200) }, { status: 422 });
  }
  const imgPersist = await persistAsset(imageUrl, { ext: '.png' }).catch(() => null);

  // ── 每引擎在同一首帧上各出一遍 ──
  const results: Array<{ provider: string; ok: boolean; videoUrl?: string; error?: string; ms: number }> = [];
  for (const p of providers) {
    const t0 = Date.now();
    try {
      let url = '';
      if (p === 'veo') {
        const { VeoService, hasVeo } = await import('@/services/veo.service');
        if (!hasVeo()) throw new Error('veo 未配置');
        url = await new VeoService().generateVideo(imageUrl, motionPrompt, { duration: 5, aspectRatio: aspect });
      } else if (p === 'minimax') {
        if (!API_CONFIG.minimax.apiKey) throw new Error('minimax 未配置');
        url = await new MinimaxService().generateVideo(imageUrl, motionPrompt, { duration: 5, aspectRatio: aspect });
      } else if (p === 'kling') {
        const { KlingService, hasKling } = await import('@/services/kling.service');
        if (!hasKling()) throw new Error('kling 未配置');
        url = await new KlingService().generateVideo(imageUrl, motionPrompt, { duration: 5, aspectRatio: aspect });
      }
      if (!url) throw new Error('空 videoUrl');
      const persisted = await persistAsset(url, { ext: '.mp4' }).catch(() => null);
      results.push({ provider: p, ok: true, videoUrl: persisted?.url || url, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ provider: p, ok: false, error: `${e instanceof Error ? e.message : e}`.slice(0, 180), ms: Date.now() - t0 });
    }
  }

  return NextResponse.json({ ok: true, imageUrl: imgPersist?.url || imageUrl, prompt: visualPrompt.slice(0, 200), results });
}
