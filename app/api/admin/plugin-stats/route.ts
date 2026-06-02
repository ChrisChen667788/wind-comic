/**
 * /api/admin/plugin-stats  (admin only) · v3.2 P4.1
 *
 * GET 返回 plugin-chain 灰度遥测聚合: 按 kind (image/video/tts) 的
 * primary 命中率 / shadow 一致率 / 平均 latency, 外加 cutoverReady 提示.
 *
 * Query:
 *   ?hours=24   只看最近 24 小时 (默认全部历史)
 *
 * Auth: JWT role = 'admin'
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { aggregatePluginStats } from '@/lib/plugin-chain-telemetry';
import { getPluginChainMode, getShadowSampleRate, pluginChainStats } from '@/lib/plugin-chain-mode';

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

  const url = new URL(request.url);
  const hoursRaw = url.searchParams.get('hours');
  const hours = hoursRaw != null ? Number(hoursRaw) : null;
  const sinceMs = hours != null && Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : undefined;

  const persisted = await aggregatePluginStats(sinceMs);

  return NextResponse.json({
    // 当前进程的运行配置
    config: {
      mode: getPluginChainMode(),
      shadowSampleRate: getShadowSampleRate(),
    },
    // 进程级实时计数 (重启即清零)
    inProcess: pluginChainStats.snapshot(),
    // SQLite 持久化聚合
    windowHours: hours ?? null,
    persisted,
  });
}
