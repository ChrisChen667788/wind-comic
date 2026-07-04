import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * v12.93.0 — 广告包装车间(一键后期工作流,榨汁杯管线沉淀)。
 *
 * 实测跑通的最佳链路固化成一次调用(此前要手动串 4 个端点):
 *   1. hook-ideas   → LLM 出 5 条合规 Hook,取前 3 作 A/B 弹药
 *   2. recompose    → karaoke 字幕 + 平台安全区 + Hook 卡(首选)+ CTA 片尾卡 + 3 变体
 *   3. publish-copy → 标题/话题/封面题
 *   4. publish-package → 一站并包返回
 * 各步自向本服务发 HTTP(转发调用方 Authorization),单步失败不连累后续(结果里如实标)。
 *
 * POST { platform?: 'douyin'|'xiaohongshu', aspect?: '9:16'|'16:9', regenVoiceover?: boolean,
 *        endCard?: {title,slogan,accentColor}, skipVariants?: boolean }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({} as any));
  const platform: string = ['douyin', 'xiaohongshu'].includes(body?.platform) ? body.platform : 'douyin';
  const aspect: string = ['9:16', '16:9', '1:1'].includes(body?.aspect) ? body.aspect : '9:16';
  const origin = new URL(request.url).origin;
  const auth = request.headers.get('authorization') || '';
  const cookie = request.headers.get('cookie') || ''; // v12.100:UI 走 httpOnly cookie 鉴权,必须一并转发
  const call = async (path: string, init?: RequestInit): Promise<any> => {
    const r = await fetch(`${origin}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: auth, Cookie: cookie, ...(init?.headers || {}) },
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  };

  const report: any = { steps: {} };

  // 1) Hook 弹药
  let hooks: string[] = [];
  try {
    const r = await call(`/api/projects/${id}/hook-ideas`, { method: 'POST', body: '{}' });
    hooks = Array.isArray(r.hooks) ? r.hooks : [];
    report.steps.hookIdeas = r.ok ? { ok: true, hooks } : { ok: false, error: r.message };
  } catch (e) { report.steps.hookIdeas = { ok: false, error: String(e).slice(0, 120) }; }

  // 2) 重合成:karaoke + 平台安全区 + Hook/CTA 卡 + 变体
  try {
    const recomposeBody: any = {
      aspect, captionStyle: 'karaoke', platform,
      regenVoiceover: body?.regenVoiceover === true,
    };
    if (hooks[0]) recomposeBody.hookCard = { title: hooks[0] };
    if (body?.endCard && typeof body.endCard === 'object') recomposeBody.endCard = body.endCard;
    if (!body?.skipVariants && hooks.length > 1) recomposeBody.hookVariants = hooks.slice(0, 3).map((t) => ({ title: t }));
    const r = await call(`/api/projects/${id}/recompose`, { method: 'POST', body: JSON.stringify(recomposeBody) });
    report.steps.recompose = r.ok
      ? { ok: true, finalVideoUrl: r.finalVideoUrl, variants: r.variants || [], hookCard: r.hookCard, endCard: r.endCard }
      : { ok: false, error: r.message };
  } catch (e) { report.steps.recompose = { ok: false, error: String(e).slice(0, 120) }; }

  // 3) 发布文案
  try {
    const r = await call(`/api/projects/${id}/publish-copy`, { method: 'POST', body: '{}' });
    report.steps.publishCopy = r.ok ? { ok: true, copy: r.copy } : { ok: false, error: r.message };
  } catch (e) { report.steps.publishCopy = { ok: false, error: String(e).slice(0, 120) }; }

  // 4) 并包
  try {
    const r = await call(`/api/projects/${id}/publish-package?platform=${platform}`);
    report.steps.package = r.finalVideoUrl || r.publishCopy
      ? { ok: true, preflight: r.preflight ?? null, qualityHealthScore: r.qualityHealthScore ?? null, abVariants: r.abVariants || [] }
      : { ok: false, error: r.message || 'package empty' };
  } catch (e) { report.steps.package = { ok: false, error: String(e).slice(0, 120) }; }

  const okCount = Object.values(report.steps).filter((s: any) => s.ok).length;
  return NextResponse.json({ ok: okCount > 0, okSteps: okCount, totalSteps: 4, ...report });
}
