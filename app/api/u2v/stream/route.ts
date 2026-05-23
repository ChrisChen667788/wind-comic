/**
 * /api/u2v/stream  · v4.1.4
 *
 * SSE 版单图生视频. POST { imageUrl(http), prompt, duration, cameraPreset }.
 * 实时推进度: submit → rendering(估算+Kling真实) → done{videoUrl} / error.
 *
 * 对比同步 /api/u2v: done/error 即时到达前端 (不必等阻塞 fetch 整个返回),
 * 进度环从"纯时间估算"升级成"真实生命周期 + Kling 真实 onProgress".
 */
import { NextRequest } from 'next/server';
import { routeVideoByDuration } from '../route';
import { createSSEResponse } from '@/lib/sse';
import { checkAndSanitize } from '@/lib/prompt-guardrails';
import { enhanceU2VMotionPrompt } from '@/lib/prompt-templates';

export const runtime = 'nodejs';
export const maxDuration = 360;

const EXPECTED: Record<number, number> = { 5: 120, 6: 120, 10: 150, 15: 180 };

export async function POST(request: NextRequest) {
  let body: any = {};
  try { body = await request.json(); } catch {}
  const imageUrl: string = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const rawPrompt: string = typeof body?.prompt === 'string' ? body.prompt : '';
  const duration: number = [5, 6, 10, 15].includes(Number(body?.duration)) ? Number(body.duration) : 5;
  const cameraPreset: string | null = typeof body?.cameraPreset === 'string' ? body.cameraPreset : null;

  // 校验 (与同步路由一致的护栏)
  if (!/^https?:\/\//i.test(imageUrl)) {
    return new Response(JSON.stringify({ error: 'imageUrl 必须是 http(s) (先经 /api/upload 落地)' }), { status: 400 });
  }
  const verdict = checkAndSanitize(rawPrompt, { task: 'u2v-motion' });
  if (!verdict.ok) {
    return new Response(JSON.stringify({ error: verdict.userMessage, category: verdict.category }), { status: 400 });
  }
  // 镜头语言增强 (与同步路由一致)
  const prompt = enhanceU2VMotionPrompt(verdict.sanitized, cameraPreset || undefined);

  return createSSEResponse(async (send) => {
    send({ event: 'progress', data: { phase: 'submit', pct: 4, msg: '提交任务…' } });

    // 服务端时间估算定时器 (minimax/vidu 无原生进度; Kling 会用真实回调覆盖)
    const expected = EXPECTED[duration] || 120;
    const t0 = Date.now();
    let lastRealPct = 0;
    const timer = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      const est = 95 * (1 - Math.exp(-sec / (0.4 * expected)));
      const pct = Math.max(lastRealPct, Math.min(95, est));
      send({ event: 'progress', data: { phase: 'rendering', pct: Math.round(pct), elapsed: Math.round(sec) } });
    }, 1000);

    try {
      const { videoUrl, model } = await routeVideoByDuration(imageUrl, prompt, duration, (pct) => {
        // Kling 真实进度: 映射到 5-95 区间, 单调不回退
        const mapped = 5 + Math.max(0, Math.min(100, pct)) * 0.9;
        lastRealPct = Math.max(lastRealPct, mapped);
        send({ event: 'progress', data: { phase: 'rendering', pct: Math.round(lastRealPct), real: true } });
      });
      clearInterval(timer);
      send({ event: 'done', data: { pct: 100, videoUrl, model } });
    } catch (e) {
      clearInterval(timer);
      send({ event: 'error', data: { error: e instanceof Error ? e.message : '生成失败' } });
    }
  });
}
