import { NextRequest, NextResponse } from 'next/server';
import { isDemoMode } from '@/services/demo-orchestrator';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 从资产库取指定镜头的分镜图 URL（storyboard 类型 + shot_number 匹配）
 *  v2.9: 优先拿 persistent_url —— 重生成很可能发生在几天之后,CDN 早过期了 */
function getStoryboardImageUrl(projectId: string, shotNumber: number): string {
  try {
    const row = db.prepare(
      `SELECT media_urls, persistent_url FROM project_assets
       WHERE project_id = ? AND type = 'storyboard' AND shot_number = ?
       ORDER BY updated_at DESC LIMIT 1`
    ).get(projectId, shotNumber) as { media_urls: string; persistent_url: string | null } | undefined;
    if (!row) return '';
    if (row.persistent_url) return row.persistent_url;
    const urls: string[] = JSON.parse(row.media_urls || '[]');
    return urls[0] || '';
  } catch (e) {
    console.warn('[regenerate-shot] failed to load storyboard asset:', e);
    return '';
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { shotNumber, duration, description, videoProvider } = await request.json();

  if (!shotNumber) {
    return NextResponse.json({ error: '请指定镜头编号' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };

      try {
        send('status', { message: `正在为您重新生成分镜 ${shotNumber} 的视频，时长设定为 ${duration || 10} 秒。` });

        if (isDemoMode()) {
          // Demo 模式：模拟重生成
          await new Promise(r => setTimeout(r, 2000));
          send('progress', { shotNumber, progress: 50 });
          await new Promise(r => setTimeout(r, 1500));

          const mockUrl = `data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#6b21a8"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><rect width="640" height="360" fill="url(#rg)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="system-ui" font-size="24">Shot ${shotNumber} v2 (${duration || 10}s)</text></svg>`
          )}`;

          send('complete', {
            shotNumber,
            videoUrl: mockUrl,
            duration: duration || 10,
            version: 2,
          });
        } else {
          // 真实模式：调用视频生成服务（优先 Veo 3.1）
          const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
          const orchestrator = new HybridOrchestrator();

          // v2.9: 贯通 style_id —— 重生成的镜头画风要跟老镜头一致
          try {
            const proj = db.prepare('SELECT style_id FROM projects WHERE id = ?').get(projectId) as { style_id?: string } | undefined;
            if (proj?.style_id) orchestrator.setUserStyle(proj.style_id);
          } catch {}

          // 构建分镜数据 —— imageUrl 从资产库取出原分镜图，用于 I2V 首帧锚定
          const imageUrl = getStoryboardImageUrl(projectId, shotNumber);
          if (imageUrl) {
            console.log(`[regenerate-shot] using stored storyboard frame: ${imageUrl.slice(0, 80)}...`);
          } else {
            console.log(`[regenerate-shot] no stored frame for shot ${shotNumber}, falling back to T2V`);
          }
          const storyboard = {
            shotNumber,
            imageUrl,
            prompt: description || '',
          };

          const provider = videoProvider || 'veo';
          send('progress', { shotNumber, progress: 20, provider });

          const result = await orchestrator.regenerateShot(shotNumber, storyboard, {
            duration: duration || 8,
            videoProvider: provider,
          });

          send('complete', {
            shotNumber,
            videoUrl: result.videoUrl,
            duration: result.duration || 8,
            version: 2,
          });
        }
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : '重生成失败' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
