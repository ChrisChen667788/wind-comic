/**
 * GET /api/api-status · v2.17 P0.3
 *
 * 公开只读 — 给所有登录用户的 dashboard 用, 让用户在创作前知道
 * "Minimax 余额不足, 视频会自动降级到 Veo" 之类的状态。
 *
 * 不返回 PII / error_message 全文 — 仅返回 provider + alertType + 最近发生时间 + 次数。
 * 真要看错误细节, 走 admin 端的 /api/admin/api-usage。
 */
import { NextResponse } from 'next/server';
import { listActiveQuotaAlerts } from '@/lib/api-usage-tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // 只看 1 小时窗口的活跃告警 — 给前端 banner 用
  const alerts = await listActiveQuotaAlerts({ windowMs: 60 * 60 * 1000 });

  // 简化输出: 每个 provider 一条 (取最严重的 alert_type)
  const SEVERITY: Record<string, number> = {
    auth_failed: 4,
    exhausted: 3,
    saturated: 2,
    rate_limited: 1,
  };
  const byProvider = new Map<
    string,
    { provider: string; alertType: string; lastSeenAt: string; count: number }
  >();
  for (const a of alerts) {
    const existing = byProvider.get(a.provider);
    if (!existing || (SEVERITY[a.alertType] || 0) > (SEVERITY[existing.alertType] || 0)) {
      byProvider.set(a.provider, {
        provider: a.provider,
        alertType: a.alertType,
        lastSeenAt: a.lastSeenAt,
        count: a.occurrenceCount,
      });
    }
  }

  return NextResponse.json({
    alerts: Array.from(byProvider.values()),
    timestamp: new Date().toISOString(),
  });
}
