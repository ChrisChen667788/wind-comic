/**
 * POST /api/telemetry/ui-event (v10.5.3) — 轻量 UI 埋点(首跑引导完成率等)。
 * 匿名可记(登录则带 userId);事件名白名单式正则;IP 限流防灌水。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { recordUiEvent } from '@/lib/repos/ui-event-repo';
import { rateLimit, clientIp, isRateLimitActive } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isRateLimitActive()) {
    const rl = rateLimit(`ui-event:${clientIp(request)}`, { limit: 60, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const event = typeof body?.event === 'string' ? body.event : '';
  const meta = body?.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta : {};
  const payload = getUserFromRequest(request);
  const ok = await recordUiEvent({ event, userId: payload?.sub ?? null, meta });
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
