/**
 * POST /api/projects/[id]/regenerate-storyboard · v2.23 P0.2
 *
 * 单镜分镜图重生 — 用户在 workshop 里改 prompt + 调引擎后重跑.
 *
 * body: {
 *   shotNumber: number,
 *   customPrompt: string,        // 用户改后的 prompt (会被 optimize + 加 --no text)
 *   useStyleBible?: boolean,     // 默认 true — 用项目的 Style Bible 作首位 sref
 *   useCref?: boolean,           // 默认 true — 用主角图作 cref
 *   aspectRatio?: '16:9'|'9:16'|...
 * }
 *
 * 200 → SSE stream:
 *   data: { type: 'status', message: ... }
 *   data: { type: 'complete', shotNumber, imageUrl, prompt }
 *   data: { type: 'error', message }
 *
 * 鉴权: 现版本 demo-friendly, 不强制 (后续 v3.0 P0.3 加 ACL).
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { createAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RegenInput {
  shotNumber: number;
  customPrompt: string;
  useStyleBible?: boolean;
  useCref?: boolean;
  aspectRatio?: string;
  /** v2.24 B: 用户上传的参考图 URL — 作 sref 优先于 Style Bible */
  referenceImageUrl?: string;
}

function getProjectContext(projectId: string): {
  styleId: string | null;
  styleAnchorUrl: string | null;
  primaryCharacterRef: string | null;
} {
  try {
    const proj = db.prepare(
      'SELECT style_id, primary_character_ref FROM projects WHERE id = ?',
    ).get(projectId) as { style_id?: string; primary_character_ref?: string } | undefined;

    // 查 Style Bible — saveAsset(projectId, 'styleBible', ...) 把 url 存进 media_urls[0]
    const bibleRow = db.prepare(
      `SELECT media_urls FROM project_assets
       WHERE project_id = ? AND type = 'styleBible'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(projectId) as { media_urls?: string } | undefined;
    let styleAnchorUrl: string | null = null;
    if (bibleRow?.media_urls) {
      try {
        const arr = JSON.parse(bibleRow.media_urls);
        if (Array.isArray(arr) && arr[0]) styleAnchorUrl = arr[0];
      } catch { /* ignore */ }
    }

    return {
      styleId: proj?.style_id || null,
      styleAnchorUrl,
      primaryCharacterRef: proj?.primary_character_ref || null,
    };
  } catch (e) {
    console.warn('[regen-sb] failed to load project context:', e);
    return { styleId: null, styleAnchorUrl: null, primaryCharacterRef: null };
  }
}

async function persistStoryboard(projectId: string, shotNumber: number, imageUrl: string, prompt: string): Promise<void> {
  try {
    // 更新该 shot_number 对应的 storyboard asset (insert new row, 保留历史)
    const id = `sb-${projectId}-${shotNumber}-${Date.now()}`;
    await createAsset({
      id, projectId, type: 'storyboard', name: `Shot ${shotNumber} (re-gen)`,
      mediaUrls: [imageUrl],
      data: { prompt, regenerated: true, regeneratedAt: new Date().toISOString() },
      shotNumber,
    });
  } catch (e) {
    console.warn('[regen-sb] persist failed:', e);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  let body: RegenInput;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { shotNumber, customPrompt, useStyleBible, useCref, aspectRatio, referenceImageUrl } = body;
  if (!shotNumber || typeof shotNumber !== 'number') {
    return new Response('shotNumber required', { status: 400 });
  }
  if (!customPrompt || typeof customPrompt !== 'string' || customPrompt.trim().length < 5) {
    return new Response('customPrompt too short (min 5 chars)', { status: 400 });
  }
  if (customPrompt.length > 2000) {
    return new Response('customPrompt too long (max 2000)', { status: 400 });
  }
  // v2.24 B: 校验上传参考图 URL — 必须 http(s) (data: URI 应该在客户端先走 /api/upload 落盘)
  if (referenceImageUrl && typeof referenceImageUrl === 'string') {
    if (!referenceImageUrl.startsWith('http')) {
      return new Response('referenceImageUrl must be http URL (upload first)', { status: 400 });
    }
  }

  const ctx = getProjectContext(projectId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)); } catch {}
      };

      try {
        send('status', { message: `重生 Shot ${shotNumber} (新 prompt)...` });

        // 用 orchestrator 的 generateImage 走完整路由 (multi-ref router / style anchor / 等)
        const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
        const orchestrator = new HybridOrchestrator();
        if (ctx.styleId) orchestrator.setUserStyle(ctx.styleId);
        if (useStyleBible !== false && ctx.styleAnchorUrl) {
          // setPreviewSeedImage 复用 (它内部存到 styleAnchorImageUrl 兼容路径? 不, 我们要 setter)
          // 直接走属性注入: 内部 generateImage 会消费 this.styleAnchorImageUrl
          (orchestrator as any).styleAnchorImageUrl = ctx.styleAnchorUrl;
        }
        if (useCref !== false && ctx.primaryCharacterRef) {
          orchestrator.setPrimaryCharacterRef(ctx.primaryCharacterRef);
        }
        if (aspectRatio) orchestrator.setAspect(aspectRatio);

        send('status', { message: `调用图像引擎...` });

        // 用户的 customPrompt 先经 sanitize + 加 --no text 等通用负向 prompt
        const { optimizeMidjourneyPrompt } = await import('@/lib/prompt-filter');
        const finalPrompt = optimizeMidjourneyPrompt(customPrompt.trim());

        // v2.24 B: 引用图优先级 — 用户上传的 referenceImage > Style Bible
        // sref 通道: 用户上传 > styleAnchor; cref 不变 (主角脸独立通道)
        const effectiveSref = referenceImageUrl
          || (useStyleBible !== false ? ctx.styleAnchorUrl : undefined)
          || undefined;
        const refImages: string[] = [];
        if (referenceImageUrl) refImages.push(referenceImageUrl);
        if (useStyleBible !== false && ctx.styleAnchorUrl && ctx.styleAnchorUrl !== referenceImageUrl) {
          refImages.push(ctx.styleAnchorUrl);
        }
        if (useCref !== false && ctx.primaryCharacterRef) refImages.push(ctx.primaryCharacterRef);

        // 走 orchestrator 的 generateImage (private), 用 hack 暴露
        const imageUrl = await (orchestrator as any).generateImage(finalPrompt, {
          aspectRatio: aspectRatio || '16:9',
          label: `Shot ${shotNumber} (manual regen${referenceImageUrl ? ' + userRef' : ''})`,
          cref: useCref !== false ? ctx.primaryCharacterRef : undefined,
          sref: effectiveSref,
          referenceImages: refImages.length > 0 ? refImages : undefined,
        });

        if (!imageUrl || imageUrl.startsWith('data:')) {
          send('error', { message: '所有图像引擎都失败了 (返回 mock 或空), 请稍后再试' });
          controller.close();
          return;
        }

        await persistStoryboard(projectId, shotNumber, imageUrl, finalPrompt);
        send('complete', { shotNumber, imageUrl, prompt: finalPrompt });
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[regen-sb] failed:', msg);
        send('error', { message: msg.slice(0, 200) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
