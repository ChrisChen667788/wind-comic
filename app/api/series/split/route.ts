/**
 * POST /api/series/split (阶段二十六 · v12.22.0) —— AI 拆集「预览」:一句设定 + 集数 → 各集梗概,
 * 但**不建项目**。供创建向导让用户先看/改各集梗概,再正式建系列。
 * 安全:登录。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { splitSeriesIntoEpisodes } from '@/lib/series-ai';
import { rateLimit, isRateLimitActive } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // v12.23.0(评审):限流防刷 LLM —— 每用户 10 次/分钟(测试环境自动关闭)
  if (isRateLimitActive()) {
    const rl = rateLimit(`series-split:${payload.sub}`, { limit: 10, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ error: '请求过于频繁,请稍后再试' }, { status: 429 });
  }

  let body: any = {}; try { body = await request.json(); } catch {}
  const premise = (typeof body?.premise === 'string' ? body.premise : '').trim().slice(0, 1000); // 防超长刷 token
  const count = Number(body?.episodeCount) || 0;
  if (!premise) return NextResponse.json({ error: '需要 premise(一句系列设定)' }, { status: 400 });
  if (count < 1 || count > 50) return NextResponse.json({ error: '集数需在 1–50' }, { status: 400 });

  try {
    const episodes = await splitSeriesIntoEpisodes(premise, count);
    // v12.24.0:回传请求集数,前端据此提示「拆集不足」(LLM 偶尔少拆)
    return NextResponse.json({ ok: true, episodes, requested: count, shortfall: Math.max(0, count - episodes.length) });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
  }
}
