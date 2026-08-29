/**
 * POST /api/projects/[id]/music (v12.203) — AI 作曲 BGM 生成入口。
 *
 * 病根:MiniMax music-2.6 生成能力(services/minimax.service.generateMusic)早已实现,但前端零入口 ——
 * 用户想按剧情定制免版权 BGM 无从触发。本路由:按风格描述生成 → 落盘持久副本 → upsert 为 music 资产
 * (recompose 自动读作 BGM,customBgm 未传时用它)。登录 + 本人项目。诚实降级:未配 MiniMax → 502 指引。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { upsertAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { MinimaxService } from '@/services/minimax.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 500) : '';
  const style = typeof body?.style === 'string' ? body.style.trim().slice(0, 60) : undefined;
  if (prompt.length < 4) return NextResponse.json({ message: '请描述想要的配乐风格(≥4 字,如「悬疑 noir,低频大提琴」)' }, { status: 400 });

  // v12.4.1 预算护栏(与视频/图同源)—— 生成前拦,超限不发生费用
  const { assertBudget } = await import('@/lib/budget-enforce');
  const b = await assertBudget({ userId: payload.sub, pendingCostCny: 1.2 }); // music-2.6 单首约 ¥1
  if (!b.allow) return NextResponse.json({ message: b.guard.message, code: 'budget_exceeded' }, { status: 402 });

  const svc = new MinimaxService();
  let url: string;
  try {
    url = await svc.generateMusic(prompt, style ? { style } : undefined);
  } catch (e) {
    // v12.376:别用猜测覆盖上游给的真话。
    // 原文案一律附上「需配置 MiniMax key 且 music-2.6 有额度」—— 而实测真因是
    // HTTP 410 / status_code 2153「This Music API is no longer available to new users」,
    // 即这个接口对本账号**永久不可用**:key 是好的、额度也不是问题,
    // 照那句话去查一辈子也查不出来。现在交给统一分类器判,并把上游原文附在后面。
    const { normalizeError } = await import('@/lib/pipeline-error');
    const pe = normalizeError(e, 'unknown');
    const raw = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { message: `AI 作曲失败:${pe.userMsg}`, code: pe.code, retryable: pe.retryable, upstream: raw.slice(0, 400) },
      { status: 502 },
    );
  }
  if (!url) return NextResponse.json({ message: 'AI 作曲未返回音频' }, { status: 502 });

  // 落盘持久副本(外链会过期)→ upsert music 资产;recompose 自动作 BGM
  const persisted = await persistAsset(url, { ext: '.mp3', contentType: 'audio/mpeg' });
  const finalUrl = persisted?.url || url;
  await upsertAsset({ projectId: id, type: 'music', name: '背景配乐(AI 作曲)', data: { prompt, style, source: 'minimax-music-2.6' }, mediaUrls: [finalUrl], persistentUrl: persisted?.url ?? null });

  return NextResponse.json({ ok: true, musicUrl: finalUrl, prompt, style: style || null });
}
