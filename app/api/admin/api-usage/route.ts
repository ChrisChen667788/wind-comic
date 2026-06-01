/**
 * /api/admin/api-usage  (admin only) · v2.17 P0.3
 *
 * GET   返回活跃配额告警 + 最近失败统计 (默认 1 小时窗口)
 * POST  ack 告警 (body: { id })
 *
 * Auth: JWT role = 'admin'
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import {
  listActiveQuotaAlerts,
  acknowledgeQuotaAlert,
  type ApiProvider,
} from '@/lib/api-usage-tracker';
import { getDbDriver } from '@/lib/db-driver';

export const runtime = 'nodejs';

function requireAdmin(request: Request): { userId: string } | NextResponse {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  return { userId: payload.sub };
}

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  // 用 URL API 而不是 request.nextUrl, 兼容 plain Request (测试时常用)
  const url = new URL(request.url);
  const windowH = Number(url.searchParams.get('hours') || 1);
  const provider = url.searchParams.get('provider') as ApiProvider | null;
  const windowMs = (Number.isFinite(windowH) ? windowH : 1) * 60 * 60 * 1000;

  // 活跃告警 (未 ack)
  const alerts = await listActiveQuotaAlerts({
    windowMs,
    provider: provider || undefined,
  });

  // 最近 N 小时按 provider 失败统计
  const since = new Date(Date.now() - windowMs).toISOString();
  const failuresByProvider = (await getDbDriver().query(
    `SELECT provider, COUNT(*) AS failed,
              MIN(created_at) AS first_at, MAX(created_at) AS last_at
       FROM api_usage_events
       WHERE success = 0 AND created_at > ?
       GROUP BY provider
       ORDER BY failed DESC`,
    [since],
  )) as Array<{ provider: string; failed: number; first_at: string; last_at: string }>;

  // 最近 50 条原始失败记录 (给 admin 翻看用)
  const recentFailures = await getDbDriver().query(
    `SELECT provider, model, method, status_code, error_message, duration_ms, created_at
       FROM api_usage_events
       WHERE success = 0 AND created_at > ?
       ORDER BY created_at DESC
       LIMIT 50`,
    [since],
  );

  return NextResponse.json({
    windowHours: windowH,
    activeAlerts: alerts,
    failuresByProvider,
    recentFailures,
  });
}

export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any = {};
  try { body = await request.json(); } catch {}
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id 必填 (要 ack 的 alert id)' }, { status: 400 });

  await acknowledgeQuotaAlert(id);
  return NextResponse.json({ ok: true, acknowledgedId: id });
}
