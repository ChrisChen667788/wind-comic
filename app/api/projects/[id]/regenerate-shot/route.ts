import { NextRequest, NextResponse } from 'next/server';
import { isDemoMode } from '@/services/demo-orchestrator';
import { db } from '@/lib/db';
import { requireProjectAccess } from '@/lib/auth-guard';

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
  const { shotNumber, duration, description, videoProvider, cameraMovement } = await request.json();

  // v12.312:**此前完全无鉴权**。下面那段预算护栏写的是「有登录态才检查」——
  // 于是匿名请求 uid 为空,**既跳过预算也没有任何归属校验**,可对任意 projectId
  // 循环触发真实付费视频生成(单次 ¥0.5–3),烧平台配额且不计费到任何账户,项目属主毫无感知。
  // 单镜重生属写操作,要 editor 权限。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ error: _g.message }, { status: _g.status });

  if (!shotNumber) {
    return NextResponse.json({ error: '请指定镜头编号' }, { status: 400 });
  }

  // v12.207:预算护栏 —— 此前本路由(项目页单镜重生)完全绕过 assertBudget,反复重生可无上限烧钱。
  // 有登录态才检查(与全局 /api/regenerate-shot 同哲学);超限返 402,不进 SSE。
  {
    const { getUserFromRequest } = await import('../../../auth/lib');
    const uid = getUserFromRequest(request)?.sub;
    if (uid) {
      const { assertBudget } = await import('@/lib/budget-enforce');
      const { estimatePipelineCostCny } = await import('@/lib/budget-estimate');
      const pending = estimatePipelineCostCny({ shotCount: 1, videoShots: 1, videoProvider, secondsPerShot: 8, skipImages: true });
      const b = await assertBudget({ userId: uid, pendingCostCny: pending });
      if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });
    }
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

          // v2.9 + v12.132(issue #2 Bug B):贯通画风 + 角色参考(此前只读 style_id,漏角色参考)
          try {
            const { parseProjectContext, applyProjectContext, PROJECT_CONTEXT_COLUMNS } = await import('@/lib/orchestrator-project-context');
            const row = db.prepare(`SELECT ${PROJECT_CONTEXT_COLUMNS} FROM projects WHERE id = ?`).get(projectId) as any;
            applyProjectContext(orchestrator, parseProjectContext(row));
          } catch {}

          // 构建分镜数据 —— imageUrl 从资产库取出原分镜图，用于 I2V 首帧锚定
          const imageUrl = getStoryboardImageUrl(projectId, shotNumber);
          if (imageUrl) {
            console.log(`[regenerate-shot] using stored storyboard frame: ${imageUrl.slice(0, 80)}...`);
          } else {
            console.log(`[regenerate-shot] no stored frame for shot ${shotNumber}, falling back to T2V`);
          }
          // v12.141(P0-1):每镜运镜覆盖 —— preset id/自由文本 → 专业运镜指令拼进视频 prompt
          const { resolveCameraMovementPrompt } = await import('@/lib/prompt-templates');
          const cameraPrompt = resolveCameraMovementPrompt(cameraMovement);
          const storyboard = {
            shotNumber,
            imageUrl,
            prompt: [description || '', cameraPrompt].filter(Boolean).join('. '),
          };
          if (cameraPrompt) console.log(`[regenerate-shot] v12.141 运镜覆盖: ${String(cameraMovement).slice(0, 30)}`);

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
