/**
 * POST /api/series/split (阶段二十六 · v12.22.0) —— AI 拆集「预览」:一句设定 + 集数 → 各集梗概,
 * 但**不建项目**。供创建向导让用户先看/改各集梗概,再正式建系列。
 * 安全:登录。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { splitSeriesIntoEpisodes } from '@/lib/series-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {}; try { body = await request.json(); } catch {}
  const premise = (typeof body?.premise === 'string' ? body.premise : '').trim();
  const count = Number(body?.episodeCount) || 0;
  if (!premise) return NextResponse.json({ error: '需要 premise(一句系列设定)' }, { status: 400 });
  if (count < 1 || count > 50) return NextResponse.json({ error: '集数需在 1–50' }, { status: 400 });

  try {
    const episodes = await splitSeriesIntoEpisodes(premise, count);
    return NextResponse.json({ ok: true, episodes });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
  }
}
