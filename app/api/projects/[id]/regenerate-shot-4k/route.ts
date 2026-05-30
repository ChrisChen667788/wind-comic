/**
 * POST /api/projects/[id]/regenerate-shot-4k · v2.16 P1.3
 *
 * 真 4K per-shot 重新渲染 — 走 Kling Master (1080p 源 + 后期 lanczos 到 2160p),
 * 而不是 export 路径的 ffmpeg 上采样。
 *
 * 入参: { shotNumber, prompt?, duration? }
 *   - shotNumber: 必须, 1-based
 *   - prompt: 可选, 不传则用现有 storyboard prompt
 *   - duration: 可选, 默认 5, 上限 10 (Kling Master 当前限制)
 *
 * Plan-gate: pro+ (4K 单镜头 60-90s, 比 1080p 贵 3-5x; 不让 free/creator 用)
 *
 * 出参 (SSE 流):
 *   { type: 'status', data: { message } }
 *   { type: 'progress', data: { progress } }   - 0..100
 *   { type: 'completed', data: { videoUrl, model, durationSec } }
 *   { type: 'error', data: { error } }
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { updateAssetBySelector } from '@/lib/repos/asset-repo';
import { KlingService } from '@/services/kling.service';
import { API_CONFIG } from '@/lib/config';
import { checkPlan, planRejection } from '@/lib/plan-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900; // 15 分钟 — 4K 单镜头慢

function getStoryboardForShot(
  projectId: string,
  shotNumber: number,
): { imageUrl: string; prompt: string } | null {
  try {
    const row = db
      .prepare(
        `SELECT media_urls, persistent_url, name FROM project_assets
         WHERE project_id = ? AND type = 'storyboard' AND shot_number = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(projectId, shotNumber) as
      | { media_urls: string; persistent_url: string | null; name: string }
      | undefined;
    if (!row) return null;
    const urls: string[] = JSON.parse(row.media_urls || '[]');
    const imageUrl = row.persistent_url || urls[0] || '';
    if (!imageUrl) return null;
    return { imageUrl, prompt: row.name || `Shot ${shotNumber}` };
  } catch (e) {
    console.warn('[regen-4k] DB read failed:', e);
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  // Plan-gate 必须 pro+ — 4K 重渲是高价位功能
  const gate = checkPlan(request, 'pro');
  if (!gate.ok) {
    console.warn(`[regen-4k] plan-gate blocked: user=${gate.userId} tier=${gate.current}`);
    return planRejection(gate.current, gate.required);
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const shotNumber = Number(body?.shotNumber);
  if (!Number.isInteger(shotNumber) || shotNumber < 1) {
    return new Response(JSON.stringify({ error: 'shotNumber 必须是 ≥1 的整数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const customPrompt = typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 500) : '';
  const duration = body?.duration === 10 ? 10 : 5;

  const storyboard = getStoryboardForShot(projectId, shotNumber);
  if (!storyboard) {
    return new Response(
      JSON.stringify({ error: `第 ${shotNumber} 镜的分镜图找不到, 无法 4K 重渲 (建议先跑通该镜分镜)` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!API_CONFIG.keling.apiKey || API_CONFIG.keling.apiKey.startsWith('your_')) {
    return new Response(
      JSON.stringify({ error: 'KELING_API_KEY 未配置, 4K 重渲依赖 Kling Master' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };

      try {
        send('status', {
          message: `🎬 第 ${shotNumber} 镜 4K 重渲启动 (Kling Master, ${duration}s, 60-90s 渲染时间)...`,
        });

        const t0 = Date.now();
        const k = new KlingService();
        const videoUrl = await k.regenerateShotAt4K(
          storyboard.imageUrl,
          customPrompt || storyboard.prompt,
          {
            duration,
            onProgress: (progress, status) => {
              send('progress', { progress, status, shotNumber });
            },
          },
        );

        const elapsedMs = Date.now() - t0;
        console.log(`[regen-4k] shot ${shotNumber} done in ${elapsedMs}ms → ${videoUrl.slice(0, 80)}`);

        // 持久化:覆盖该镜头的 video 资产 + 标记 quality=4k
        try {
          await updateAssetBySelector(
            projectId, { type: 'video', shotNumber },
            { mediaUrls: [videoUrl], persistentUrl: videoUrl, data: { quality: '4k', engine: 'kling-master', regeneratedAt: new Date().toISOString() } },
          );
        } catch (e) {
          console.warn('[regen-4k] DB update failed (non-fatal):', e);
        }

        send('completed', {
          videoUrl,
          shotNumber,
          model: 'kling-master',
          quality: '4k',
          durationSec: duration,
          elapsedMs,
        });
        controller.close();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[regen-4k] shot ${shotNumber} failed:`, errMsg);
        send('error', { error: errMsg, shotNumber });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
