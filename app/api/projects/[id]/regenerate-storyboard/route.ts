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
import { createAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { requireProjectAccess } from '@/lib/auth-guard';
import { NextResponse } from 'next/server';

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
  /** v12.136 issue #2:草图锁 —— 开启则用该镜 storyboard-sketch(或 sketchUrl)锁构图 */
  sketchLock?: boolean;
  sketchUrl?: string;
  sketchMeta?: { shotSize?: string; angle?: string; movement?: string };
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
    // v12.343:名叫 persistStoryboard,却只写了 DB 行 —— 图片本身从没落过盘。
    // 存进去的是引擎外链(hailuo-*.aliyuncs.com 之类),几天后 403,于是「重生成功」
    // 的分镜过一阵就全变裂图。owner 那 30 个项目的老素材正是这样一批一批失效的。
    // 主管线 create-pipeline 一直走 persistAsset,只有这条重生路径漏接。
    const persisted = await persistAsset(imageUrl).catch(() => null);
    const finalUrl = persisted?.url || imageUrl;
    if (!persisted) console.warn(`[regen-sb] 落盘失败,回退外链(会过期):${imageUrl.slice(0, 80)}`);

    // 更新该 shot_number 对应的 storyboard asset (insert new row, 保留历史)
    const id = `sb-${projectId}-${shotNumber}-${Date.now()}`;
    await createAsset({
      id, projectId, type: 'storyboard', name: `Shot ${shotNumber} (re-gen)`,
      mediaUrls: [finalUrl],
      persistentUrl: persisted?.url || null,
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
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  let body: RegenInput;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { shotNumber, customPrompt, useStyleBible, useCref, aspectRatio, referenceImageUrl, sketchLock, sketchUrl: bodySketchUrl, sketchMeta } = body;
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

        // v12.136(issue #2 草图锁):开启 sketchLock 时用该镜草图锁构图。
        // sketchUrl 优先 body 传入,否则自动取该镜已存的 storyboard-sketch 资产。
        let effectiveSketchUrl: string | undefined = typeof bodySketchUrl === 'string' && bodySketchUrl.startsWith('http') ? bodySketchUrl : undefined;
        if (sketchLock === true && !effectiveSketchUrl) {
          try {
            const { assetShotNumber, assetFirstMediaUrl } = await import('@/lib/heal-shots');
            const sketches = await listAssetsByType(projectId, 'storyboard-sketch');
            const mine = sketches.filter((a: any) => assetShotNumber(a) === shotNumber).slice(-1)[0] as any;
            effectiveSketchUrl = (mine && assetFirstMediaUrl(mine)) || undefined; // v12.138:蛇形行兼容(live 抓获)
          } catch { /* 无草图 → 不锁 */ }
        }

        // 走 orchestrator 的 generateImage (private), 用 hack 暴露
        const imageUrl = await (orchestrator as any).generateImage(finalPrompt, {
          aspectRatio: aspectRatio || '16:9',
          label: `Shot ${shotNumber} (manual regen${referenceImageUrl ? ' + userRef' : ''}${effectiveSketchUrl && sketchLock ? ' + sketchLock' : ''})`,
          cref: useCref !== false ? ctx.primaryCharacterRef : undefined,
          sref: effectiveSref,
          referenceImages: refImages.length > 0 ? refImages : undefined,
          sketchUrl: sketchLock === true ? effectiveSketchUrl : undefined, // v12.135 generateImage 消费
          sketchLock: sketchLock === true ? true : undefined,
          sketchMeta: sketchMeta && typeof sketchMeta === 'object' ? sketchMeta : undefined,
        });

        if (!imageUrl || imageUrl.startsWith('data:')) {
          // v12.371:原文案是「请稍后再试」——**对多数真实原因都是错的建议**:
          // 额度耗尽、prompt 被判敏感、网关分组受限,重试同样的东西都不会成功。
          // 而原因**早就写进 api_usage_events 了**,只是没人交回给用户。
          const { recentImageFailure } = await import('@/lib/recent-failure');
          const hint = recentImageFailure();
          send('error', {
            message: hint?.advice
              ? `图像生成失败(${hint.provider}):${hint.advice}`
              : hint?.raw
                ? `所有图像引擎都失败了 —— 最近一次上游报错(${hint.provider}):${hint.raw}`
                : '所有图像引擎都失败了(返回 mock 或空),且未取到上游报错;请查看服务日志',
            ...(hint ? { upstream: hint.raw, provider: hint.provider } : {}),
          });
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
