/**
 * /api/cron/run-scheduled-publishes (v12.3.3) — 定时发布 worker tick 触发端点(阶段二十二)。
 *
 * 外部 cron(Vercel Cron / 系统 crontab / 手动)周期 POST 此端点 → runDuePublishes(now)。
 * 鉴权:Authorization: Bearer <CRON_SECRET>。生产必须设 CRON_SECRET(未设 → 503,拒跑);
 *        非生产且未设 → 放行(本地手动触发方便)。绝不无保护地暴露外发动作。
 */
import { NextResponse } from 'next/server';
import { runDuePublishes } from '@/lib/publish-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request): { ok: boolean; status?: number; error?: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return { ok: false, status: 503, error: '未配置 CRON_SECRET,拒绝在生产无保护触发' };
    return { ok: true }; // 本地放行
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== secret) return { ok: false, status: 401, error: 'CRON_SECRET 不匹配' };
  return { ok: true };
}

async function run() {
  const result = await runDuePublishes(new Date().toISOString());
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: Request) {
  const a = authorized(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  return run();
}

// 便于 Vercel Cron(默认 GET)触发
export async function GET(request: Request) {
  const a = authorized(request);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  return run();
}
