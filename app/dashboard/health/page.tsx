'use client';

/**
 * v6.7 — API 健康仪表盘. 一眼看每个网关/模型 正常 / 额度用尽 / 配置缺失 / 不可达.
 * 数据来自 /api/health/providers (服务端实时探测, 缓存 60s, 不回传任何 key).
 */

import { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, CircleDashed, Wallet } from 'lucide-react';
import { STATUS_META, type ProviderHealth, type HealthStatus } from '@/lib/provider-health';

const TONE_CLS: Record<string, string> = {
  ok: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  warn: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  bad: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  muted: 'text-[var(--muted)] bg-white/5 border-white/10',
};
const STATUS_ICON: Record<HealthStatus, typeof CheckCircle2> = {
  ok: CheckCircle2, out_of_credits: XCircle, auth_error: XCircle,
  misconfigured: AlertTriangle, down: XCircle, not_configured: CircleDashed,
};
const KIND_LABEL: Record<string, string> = { llm: '大模型', tts: '语音', video: '视频', image: '图像', gateway: '网关' };
const OVERALL: Record<string, { label: string; cls: string }> = {
  healthy: { label: '全部正常', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  warning: { label: '有警告', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  critical: { label: '有故障 / 欠费', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
};

export default function HealthPage() {
  const [data, setData] = useState<{ overall: string; checkedAt: string; providers: ProviderHealth[]; cached?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/health/providers${fresh ? '?fresh=1' : ''}`);
      setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const ov = data ? OVERALL[data.overall] : null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6 text-amber-400" />API 健康</h2>
          <p className="text-sm text-[var(--muted)] mt-1">各模型 / 网关实时状态 · 一眼看谁欠费或掉线</p>
        </div>
        <div className="flex items-center gap-3">
          {ov && <span className={`px-3 py-1 rounded-full text-xs font-medium border ${ov.cls}`}>{ov.label}</span>}
          <button
            onClick={() => load(true)} disabled={loading}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}重新探测
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-center py-16 text-[var(--muted)]"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : !data ? (
        <p className="text-sm text-rose-300">探测失败</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.providers.map((p) => {
              const meta = STATUS_META[p.status];
              const Icon = STATUS_ICON[p.status];
              return (
                <div key={p.id} className={`rounded-2xl border p-4 ${TONE_CLS[meta.tone]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="text-sm font-semibold text-white truncate">{p.label}</span>
                      </div>
                      <div className="text-[10px] text-[var(--soft)] mt-0.5">{KIND_LABEL[p.kind] || p.kind}{p.baseUrl ? ` · ${p.baseUrl.replace(/^https?:\/\//, '')}` : ''}</div>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium border ${TONE_CLS[meta.tone]}`}>{meta.label}</span>
                  </div>

                  <p className="text-[11px] text-white/70 mt-2 break-all line-clamp-2">{p.detail}</p>

                  {p.balance && (p.balance.limitUsd != null || p.balance.remainingUsd != null) && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/80">
                      <Wallet className="w-3 h-3" />
                      {p.balance.remainingUsd != null
                        ? <span>剩余 <b>${p.balance.remainingUsd}</b> / 上限 ${p.balance.limitUsd}{p.balance.usedUsd != null ? ` · 已用 $${p.balance.usedUsd}` : ''}</span>
                        : <span>上限 ${p.balance.limitUsd}</span>}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between">
                    {meta.action ? <span className="text-[11px] font-medium">→ {meta.action}</span> : <span />}
                    {p.latencyMs != null && <span className="text-[10px] text-[var(--soft)]">{p.latencyMs}ms</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-[11px] text-[var(--soft)]">
            探测于 {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : '—'}{data.cached ? ' · 缓存结果 (点「重新探测」强制刷新)' : ''} · 仪表盘只读各家额度,不存储/不回传任何 API Key。
          </p>
        </>
      )}
    </div>
  );
}
