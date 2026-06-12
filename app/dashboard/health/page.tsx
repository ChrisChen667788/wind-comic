'use client';

/**
 * v6.7 — API 健康仪表盘. 一眼看每个网关/模型 正常 / 额度用尽 / 配置缺失 / 不可达.
 * 数据来自 /api/health/providers (服务端实时探测, 缓存 60s, 不回传任何 key).
 */

import { useState, useEffect, useCallback } from 'react';
import { Pulse as Activity, ArrowsClockwise as RefreshCw, CircleNotch as Loader2, CheckCircle as CheckCircle2, Warning as AlertTriangle, XCircle, CircleDashed, Wallet, Broadcast as Radar, ArrowUp, ArrowCounterClockwise } from '@phosphor-icons/react';
import { STATUS_META, type ProviderHealth, type HealthStatus } from '@/lib/provider-health';
import { getToken } from '@/lib/auth';

// v10.6.3 模型雷达
interface ScanRow {
  module: string; label: string; envKey: string; current: string;
  familyCandidates: number; latest: string | null;
  status: 'upgrade' | 'up-to-date' | 'source-unavailable'; note?: string;
}
interface ScanReport {
  scannedAt: string;
  results: ScanRow[];
  unscannable: Array<{ module: string; label: string; why: string }>;
  overrides: Array<{ envKey: string; value: string; prevValue: string | null; updatedAt: string }>;
}

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
  // v10.6.3 模型雷达
  const [scan, setScan] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [radarMsg, setRadarMsg] = useState<string>('');

  const runScan = useCallback(async () => {
    setScanning(true); setRadarMsg('');
    try {
      const res = await fetch('/api/health/model-scan');
      if (res.ok) setScan(await res.json());
      else setRadarMsg('扫描失败');
    } catch { setRadarMsg('扫描失败'); }
    finally { setScanning(false); }
  }, []);

  const applyUpgrades = useCallback(async () => {
    setApplying(true); setRadarMsg('');
    try {
      const t = getToken();
      const res = await fetch('/api/health/model-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ apply: true }),
      });
      const b = await res.json();
      if (res.ok && b.ok) {
        const up = (b.applied || []).map((a: any) => `${a.from} → ${a.to}`).join('、');
        const skip = (b.skipped || []).length;
        setRadarMsg(b.applied?.length ? `已升级 ${b.applied.length} 项:${up}${skip ? `(${skip} 项实测未过维持原值)` : ''} — 免重启已生效` : skip ? `${skip} 项候选实测未通过,维持现配置` : '没有可升级项');
        await runScan();
      } else setRadarMsg(b.message || '升级失败(需登录)');
    } catch { setRadarMsg('升级失败'); }
    finally { setApplying(false); }
  }, [runScan]);

  const rollback = useCallback(async (envKey: string) => {
    try {
      const t = getToken();
      const res = await fetch('/api/health/model-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ rollback: envKey }),
      });
      if (res.ok) { setRadarMsg(`${envKey} 已回滚`); await runScan(); }
    } catch { /* 静默 */ }
  }, [runScan]);

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

                  {p.balance && (p.balance.limitUsd != null || p.balance.usedUsd != null) && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/80">
                      <Wallet className="w-3 h-3" />
                      {(p.balance.limitUsd ?? 0) >= 1_000_000
                        // 上限是占位高值 (预付/充值制) → 只显已用, 标额度充裕
                        ? <span>已用 <b>${p.balance.usedUsd ?? 0}</b> · 额度充裕(充值制)</span>
                        : p.balance.remainingUsd != null
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

          {/* v10.6.3 — 模型雷达:一键扫描各 API 最新模型 + 同家族自动升级 */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4" data-testid="model-radar">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-1.5"><Radar className="w-4 h-4 text-amber-400" />模型雷达</h3>
                <p className="text-[11px] text-[var(--muted)] mt-0.5">扫描各 API 支持的最新模型 · 同家族才升级 · LLM 先 1-token 实测 · 留回滚 · 免重启生效</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={runScan} disabled={scanning}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white/5 text-white/80 border border-white/15 hover:bg-white/10 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}扫描最新模型
                </button>
                {scan && scan.results.some((r) => r.status === 'upgrade') && (
                  <button onClick={applyUpgrades} disabled={applying}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1.5">
                    {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}一键升级到最新最强
                  </button>
                )}
              </div>
            </div>

            {radarMsg && <p className="mt-2 text-[11px] text-amber-300" role="status">{radarMsg}</p>}

            {scan && (
              <div className="mt-3 space-y-1.5">
                {scan.results.map((r) => (
                  <div key={r.module} className="flex items-center gap-2 text-[11.5px] rounded-lg border border-white/10 bg-black/20 px-3 py-2 flex-wrap">
                    <span className="text-white/80 font-medium w-56 shrink-0 truncate">{r.label}</span>
                    <span className="cinema-mono text-white/60 truncate">{r.current}</span>
                    {r.status === 'upgrade' && r.latest && (
                      <span className="inline-flex items-center gap-1 text-amber-300"><ArrowUp className="w-3 h-3" />{r.latest}</span>
                    )}
                    <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${
                      r.status === 'upgrade' ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
                      : r.status === 'up-to-date' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                      : 'text-white/40 border-white/10 bg-white/5'}`}>
                      {r.status === 'upgrade' ? '可升级' : r.status === 'up-to-date' ? `已最新${r.familyCandidates ? ` · 家族 ${r.familyCandidates} 款` : ''}` : '来源不可用'}
                    </span>
                    {r.note && <span className="w-full text-[10px] text-white/35">{r.note}</span>}
                  </div>
                ))}

                {scan.overrides.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[10px] text-white/45 mb-1">现行覆盖(可回滚到升级前):</div>
                    {scan.overrides.map((o) => (
                      <div key={o.envKey} className="flex items-center gap-2 text-[11px] text-white/60 py-0.5">
                        <span className="cinema-mono">{o.envKey} = {o.value}</span>
                        <button onClick={() => rollback(o.envKey)} className="inline-flex items-center gap-1 text-white/50 hover:text-white text-[10px] border border-white/15 rounded px-1.5 py-0.5">
                          <ArrowCounterClockwise className="w-3 h-3" />回滚{o.prevValue ? ` → ${o.prevValue}` : '(回代码默认)'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-1 text-[10px] text-white/35">
                  {scan.unscannable.map((u) => (<div key={u.module}>· {u.label}:{u.why}</div>))}
                </div>
              </div>
            )}
          </div>

          <p className="mt-4 text-[11px] text-[var(--soft)]">
            探测于 {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : '—'}{data.cached ? ' · 缓存结果 (点「重新探测」强制刷新)' : ''} · 仪表盘只读各家额度,不存储/不回传任何 API Key。
          </p>
        </>
      )}
    </div>
  );
}
