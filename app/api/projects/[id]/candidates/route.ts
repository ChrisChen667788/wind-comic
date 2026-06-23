/**
 * POST /api/projects/[id]/candidates · 阶段二十九 v12.34.0(九宫格 2/3)
 *
 * 为某镜一次生成 N 个**构图各异**的候选关键帧(九宫格),SSE 逐格回流 → 前端网格实时填充 →
 * 用户挑最优(走 /candidates/pick)→ 选中帧作首帧 seed。把 AI 随机性从「碰运气」变「筛选池」。
 *
 * body: { shotNumber:number, basePrompt:string, count?:4|6|9, aspectRatio?, useStyleBible?, useCref? }
 * SSE:
 *   data:{type:'status',message}
 *   data:{type:'candidate', candidate:{id,index,variantLabel,imageUrl}}   // 逐格
 *   data:{type:'complete', shotNumber, grid:{cols,rows}, candidates:[...]}
 *   data:{type:'error', message}
 *
 * 鉴权:登录 + 属主守卫;真花钱端点 → assertBudget 预算护栏(每张约 ¥0.3)。
 * 并发复用 v12.32 的 GEN_CONCURRENCY_STORYBOARD(默认 2)。
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { createAsset } from '@/lib/repos/asset-repo';
import { getUserFromRequest } from '../../../auth/lib';
import { assertBudget } from '@/lib/budget-enforce';
import { buildCandidatePrompts, clampCandidateCount, gridDimensions } from '@/lib/candidate-grid';
import { resolveConcurrency } from '@/lib/gen-concurrency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EST_COST_PER_IMG_CNY = 0.3;

function getProjectContext(projectId: string): {
  userId: string | null; styleId: string | null; styleAnchorUrl: string | null; primaryCharacterRef: string | null;
} {
  try {
    const proj = db.prepare('SELECT user_id, style_id, primary_character_ref FROM projects WHERE id = ?')
      .get(projectId) as { user_id?: string; style_id?: string; primary_character_ref?: string } | undefined;
    const bibleRow = db.prepare(
      `SELECT media_urls FROM project_assets WHERE project_id = ? AND type = 'styleBible' ORDER BY created_at DESC LIMIT 1`,
    ).get(projectId) as { media_urls?: string } | undefined;
    let styleAnchorUrl: string | null = null;
    if (bibleRow?.media_urls) {
      try { const arr = JSON.parse(bibleRow.media_urls); if (Array.isArray(arr) && arr[0]) styleAnchorUrl = arr[0]; } catch { /* ignore */ }
    }
    return {
      userId: proj?.user_id || null,
      styleId: proj?.style_id || null,
      styleAnchorUrl,
      primaryCharacterRef: proj?.primary_character_ref || null,
    };
  } catch (e) {
    console.warn('[candidates] load ctx failed:', e);
    return { userId: null, styleId: null, styleAnchorUrl: null, primaryCharacterRef: null };
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return new Response('Unauthorized', { status: 401 });

  let body: { shotNumber?: number; basePrompt?: string; count?: number; aspectRatio?: string; useStyleBible?: boolean; useCref?: boolean };
  try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const { shotNumber, basePrompt, count, aspectRatio, useStyleBible, useCref } = body;
  if (!shotNumber || typeof shotNumber !== 'number') return new Response('shotNumber required', { status: 400 });
  if (!basePrompt || typeof basePrompt !== 'string' || basePrompt.trim().length < 5) return new Response('basePrompt too short (min 5)', { status: 400 });
  if (basePrompt.length > 2000) return new Response('basePrompt too long (max 2000)', { status: 400 });

  const ctx = getProjectContext(projectId);
  if (ctx.userId && ctx.userId !== payload.sub) return new Response('Forbidden', { status: 403 });

  const n = clampCandidateCount(count);
  // 预算护栏:一次出 N 张图
  const budget = await assertBudget({ userId: payload.sub, pendingCostCny: n * EST_COST_PER_IMG_CNY });
  if (!budget.allow) {
    return new Response(JSON.stringify({ error: '本月预算已达上限,候选生成已拦截', guard: budget.guard }), { status: 402, headers: { 'Content-Type': 'application/json' } });
  }

  const candidates = buildCandidatePrompts(basePrompt.trim(), { count: n });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)); } catch { /* closed */ }
      };
      try {
        send('status', { message: `生成 ${n} 个候选构图(九宫格)…` });

        const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
        const orchestrator = new HybridOrchestrator();
        if (ctx.styleId) orchestrator.setUserStyle(ctx.styleId);
        if (useStyleBible !== false && ctx.styleAnchorUrl) (orchestrator as unknown as { styleAnchorImageUrl?: string }).styleAnchorImageUrl = ctx.styleAnchorUrl;
        if (useCref !== false && ctx.primaryCharacterRef) orchestrator.setPrimaryCharacterRef(ctx.primaryCharacterRef);
        if (aspectRatio) orchestrator.setAspect(aspectRatio);
        const { optimizeMidjourneyPrompt } = await import('@/lib/prompt-filter');

        const refImages: string[] = [];
        if (useStyleBible !== false && ctx.styleAnchorUrl) refImages.push(ctx.styleAnchorUrl);
        if (useCref !== false && ctx.primaryCharacterRef) refImages.push(ctx.primaryCharacterRef);

        const done: Array<{ id: string; index: number; variantLabel: string; prompt: string; imageUrl: string }> = [];

        // 有界并发(复用 v12.32 GEN_CONCURRENCY_STORYBOARD,默认 2),逐格出图即推送
        const concurrency = resolveConcurrency('storyboard', n);
        let next = 0;
        const worker = async () => {
          while (next < candidates.length) {
            const cand = candidates[next++];
            try {
              const finalPrompt = optimizeMidjourneyPrompt(cand.prompt);
              const imageUrl = await (orchestrator as unknown as {
                generateImage: (p: string, o: Record<string, unknown>) => Promise<string>;
              }).generateImage(finalPrompt, {
                aspectRatio: aspectRatio || '16:9',
                label: `Shot ${shotNumber} 候选 ${cand.id}(${cand.variantLabel})`,
                cref: useCref !== false ? ctx.primaryCharacterRef : undefined,
                sref: useStyleBible !== false ? ctx.styleAnchorUrl : undefined,
                referenceImages: refImages.length > 0 ? refImages : undefined,
              });
              if (imageUrl && !imageUrl.startsWith('data:')) {
                done.push({ id: cand.id, index: cand.index, variantLabel: cand.variantLabel, prompt: finalPrompt, imageUrl });
                send('candidate', { candidate: { id: cand.id, index: cand.index, variantLabel: cand.variantLabel, imageUrl } });
              } else {
                send('candidate', { candidate: { id: cand.id, index: cand.index, variantLabel: cand.variantLabel, error: 'engine returned empty/mock' } });
              }
            } catch (e) {
              send('candidate', { candidate: { id: cand.id, index: cand.index, variantLabel: cand.variantLabel, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) } });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

        if (done.length === 0) { send('error', { message: '所有候选都生成失败,请稍后再试' }); controller.close(); return; }

        // 候选集落库(供 /pick 服务端权威校验 + 取图)
        try {
          await createAsset({
            id: `cand-${projectId}-${shotNumber}-${Date.now()}`,
            projectId, type: 'candidate_set', name: `Shot ${shotNumber} 候选集(${done.length})`,
            mediaUrls: done.map((d) => d.imageUrl),
            data: { shotNumber, candidates: done },
            shotNumber,
          });
        } catch (e) { console.warn('[candidates] persist set failed:', e); }

        const ordered = done.sort((a, b) => a.index - b.index);
        send('complete', { shotNumber, grid: gridDimensions(n), candidates: ordered });
        controller.close();
      } catch (e) {
        send('error', { message: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } });
}
