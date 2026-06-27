'use client';

/**
 * v9.3.2 — 创作者用量与成本面板.
 *
 * 消费 GET /api/usage/summary → 预算环(当月) + 引擎花费条 + 每日趋势 + 活跃配额告警 banner
 *   + 按 provider 失败计数。创作者可见(非仅 admin),复用 API 健康看板设计语言。
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ChartLineUp, ArrowsClockwise as RefreshCw, CircleNotch as Loader2,
  WarningCircle as AlertTriangle, CurrencyCny, Stack, ShieldCheck,
} from '@phosphor-icons/react';
import type { CostSummary, BudgetStatus } from '@/lib/cost-rollup';
import type { BudgetGuardResult } from '@/lib/budget-guard';

interface Alert { provider: string; model: string; alertType: string; occurrenceCount: number; errorMessage: string; }
interface Summary {
  scope: string;
  window: { days: number; since: string };
  cost: CostSummary;
  budget: BudgetStatus;
  guard: BudgetGuardResult;
  activeAlerts: Alert[];
  failuresByProvider: Array<{ provider: string; failed: number }>;
}

const STATUS_TONE: Record<string, string> = {
  ok: 'text-emerald-300 border-emerald-500/30',
  warn: 'text-amber-300 border-amber-500/30',
  over: 'text-rose-300 border-rose-500/30',
  none: 'text-[var(--muted)] border-white/10',
};
const STATUS_LABEL: Record<string, string> = { ok: '预算健康', warn: '接近上限', over: '已超预算', none: '未设上限' };
const RING_STROKE: Record<string, string> = { ok: '#22D3A5', warn: '#E8C547', over: '#C8432A', none: '#4A4744' };
const ALERT_LABEL: Record<string, string> = {
  exhausted: '额度耗尽', saturated: '上游饱和', rate_limited: '限流', auth_failed: '鉴权失败', model_unavailable: '模型不可用',
};
const GUARD_TONE: Record<string, string> = {
  none: 'text-[var(--muted)] border-white/10 bg-white/5',
  ok: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5',
  warn: 'text-amber-300 border-amber-500/30 bg-amber-500/5',
  soft_over: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  hard_block: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
};
const cny = (n: number) => `¥${(Number(n) || 0).toFixed(2)}`;

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const [cap, setCap] = useState('');
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async (d: number) => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/usage/summary?days=${d}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || '加载失败');
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // v9.3.4: 月预算改存服务端 — 初次拉已存值
  useEffect(() => {
    fetch('/api/usage/budget').then((r) => (r.ok ? r.json() : null)).then((b) => {
      if (b && b.capCny != null) setCap(String(b.capCny));
    }).catch(() => {});
  }, []);

  // 失焦保存预算 → 重算 guard
  const saveCap = useCallback(async () => {
    try {
      await fetch('/api/usage/budget', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capCny: cap && Number(cap) > 0 ? Number(cap) : null }),
      });
    } catch { /* ignore */ }
    load(days);
  }, [cap, days, load]);

  useEffect(() => { load(days); }, [days, load]);

  const b = data?.budget;
  const pct = b && b.pctUsed != null ? Math.max(0, Math.min(1, b.pctUsed)) : 0;
  const ringTone = b?.status || 'none';
  const C = 2 * Math.PI * 32; // r=32

  const engines = data?.cost.byEngine || [];
  const maxEngine = Math.max(1, ...engines.map((e) => e.costCny));
  // 每日趋势:把稀疏的 byDay(只含有花费的日子)填成窗口内连续每一天(缺失日补 0)。
  // 否则非连续日期被等宽并列 → 误导;同时柱子定高 bug 一并修(见下方渲染)。
  const trend = buildDailyTrend(data?.cost.byDay || [], data?.window?.since, data?.window?.days || 0);
  const maxDay = Math.max(1, ...trend.map((d) => d.costCny));
  const labelEvery = Math.max(1, Math.ceil(trend.length / 8)); // 标签抽稀,避免 30/90 天挤成一团

  return (
    <div className="cinema-page max-w-5xl mx-auto flex flex-col gap-5">
      {/* header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="cinema-eyebrow flex items-center gap-1.5"><ChartLineUp size={14} className="text-[var(--primary)]" /> 用量与成本</div>
          <h1 className="cinema-headline text-2xl mt-1">成本可观测</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 cinema-mono text-[10px] opacity-70">
            月预算 ¥
            <input type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} onBlur={saveCap} placeholder="不限"
              className="w-20 bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--primary)]" />
          </label>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`cinema-btn !text-[11px] !py-1 ${days === d ? 'cinema-btn-primary' : 'cinema-btn-ghost'}`}>近 {d} 天</button>
          ))}
          <button onClick={() => load(days)} className="cinema-btn-ghost !p-1.5" title="刷新"><RefreshCw size={14} /></button>
        </div>
      </div>

      {loading && <div className="cinema-card !p-8 flex items-center justify-center gap-2 text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /> 加载中…</div>}
      {err && !loading && <div className="cinema-card !p-4 flex items-center gap-2 text-[var(--secondary)] text-sm"><AlertTriangle size={15} /> {err}</div>}

      {data && !loading && (
        <>
          {/* 活跃配额告警 banner */}
          {data.activeAlerts.length > 0 && (
            <div className="cinema-card !p-3 border border-[var(--secondary)]/40 bg-[var(--secondary)]/5">
              <div className="cinema-eyebrow text-[var(--secondary)] mb-1.5 flex items-center gap-1.5"><AlertTriangle size={13} /> 活跃配额告警 · 近 1 小时</div>
              <div className="flex flex-col gap-1">
                {data.activeAlerts.slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="cinema-mono text-[var(--secondary)] uppercase">{a.provider}</span>
                    <span className="cinema-chip cinema-chip-amber !text-[9px]">{ALERT_LABEL[a.alertType] || a.alertType}</span>
                    <span className="opacity-60 truncate flex-1" title={a.errorMessage}>{a.errorMessage}</span>
                    <span className="cinema-mono opacity-50 shrink-0">×{a.occurrenceCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 预算护栏状态条 */}
          {data.guard.level !== 'none' && (
            <div className={`cinema-card !p-3 border flex items-center gap-2 ${GUARD_TONE[data.guard.level] || GUARD_TONE.none}`}>
              <ShieldCheck size={15} weight="fill" className="shrink-0" />
              <span className="text-[12px] flex-1">{data.guard.message}</span>
              {!data.guard.allow && <a href={data.guard.upgradeUrl} className="cinema-btn-ghost !text-[10px] shrink-0">去计费</a>}
            </div>
          )}

          {/* 预算环 + 总览 */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
            <div className={`cinema-card !p-4 flex items-center gap-4 border ${STATUS_TONE[ringTone]}`}>
              <div className="relative shrink-0" style={{ width: 84, height: 84 }}>
                <svg width="84" height="84" className="-rotate-90">
                  <circle cx="42" cy="42" r="32" fill="none" stroke="var(--border)" strokeWidth="7" />
                  <circle cx="42" cy="42" r="32" fill="none" stroke={RING_STROKE[ringTone]} strokeWidth="7"
                    strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset .6s' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="cinema-mono text-base tabular-nums">{b && b.pctUsed != null ? `${Math.round(b.pctUsed * 100)}%` : '—'}</span>
                  <span className="cinema-mono text-[8px] opacity-50">{STATUS_LABEL[ringTone]}</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="cinema-eyebrow !text-[9px] opacity-60">本月预算</div>
                <div className="cinema-mono text-lg mt-0.5">{cny(b?.spentCny || 0)}{b?.capCny != null && <span className="opacity-50 text-sm"> / {cny(b.capCny)}</span>}</div>
                <div className="cinema-mono text-[10px] opacity-50 mt-0.5">预计月末 {cny(b?.projectedPeriodEndCny || 0)}{b?.capCny == null && ' · 未设上限'}</div>
              </div>
            </div>

            <div className="cinema-card !p-4 grid grid-cols-3 gap-3">
              <Stat label={`近 ${data.window.days} 天花费`} value={cny(data.cost.totals.costCny)} icon={<CurrencyCny size={13} />} />
              <Stat label="生成次数" value={String(data.cost.totals.count)} icon={<Stack size={13} />} />
              <Stat label="引擎数" value={String(engines.length)} icon={<ChartLineUp size={13} />} />
            </div>
          </div>

          {/* 引擎花费条 */}
          <div className="cinema-card !p-4">
            <div className="cinema-eyebrow mb-3 flex items-center gap-1.5"><CurrencyCny size={13} className="text-[var(--primary)]" /> 引擎花费 · 近 {data.window.days} 天</div>
            {engines.length === 0 && <div className="cinema-mono text-[11px] opacity-50">该窗口暂无成本记录。</div>}
            <div className="flex flex-col gap-2">
              {engines.map((e) => (
                <div key={e.engine} className="flex items-center gap-3">
                  <span className="cinema-mono text-[11px] w-24 shrink-0 truncate" title={e.engine}>{e.engine}</span>
                  <div className="flex-1 h-3.5 rounded bg-[var(--border)] overflow-hidden">
                    <div className="h-full bg-[var(--primary)] rounded transition-all duration-500" style={{ width: `${(e.costCny / maxEngine) * 100}%` }} />
                  </div>
                  <span className="cinema-mono text-[11px] tabular-nums w-20 text-right shrink-0">{cny(e.costCny)}</span>
                  <span className="cinema-mono text-[10px] opacity-40 w-10 text-right shrink-0">×{e.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 每日趋势 */}
          <div className="cinema-card !p-4">
            <div className="cinema-eyebrow mb-3 flex items-center gap-1.5"><ChartLineUp size={13} className="text-[var(--accent)]" /> 每日成本趋势</div>
            {trend.length === 0 && <div className="cinema-mono text-[11px] opacity-50">暂无每日数据。</div>}
            {trend.length > 0 && (
              <div className="flex items-stretch gap-px h-28">
                {trend.map((d, i) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group min-w-0" title={`${d.day} · ${cny(d.costCny)} · ${d.count} 次`}>
                    {/* 柱轨:flex-1 给出确定高度,柱子 height:% 才有基准(原 bug:父列无定高 → % 解析为 0) */}
                    <div className="flex-1 w-full flex items-end min-h-0">
                      <div className="w-full rounded-t bg-[var(--accent)]/70 group-hover:bg-[var(--accent)] transition-colors"
                        style={{ height: `${d.costCny > 0 ? Math.max(4, (d.costCny / maxDay) * 100) : 0}%` }} />
                    </div>
                    <span className="cinema-mono text-[7px] opacity-40 truncate w-full text-center leading-none h-2.5">
                      {i % labelEvery === 0 ? d.day.slice(5) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div>
      <div className="cinema-eyebrow !text-[9px] opacity-60 flex items-center gap-1">{icon} {label}</div>
      <div className="cinema-mono text-lg mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

/**
 * 把稀疏的 byDay 填成连续每日趋势:从 window.since(或最早记录日)起,
 * 覆盖整个窗口的每一天,缺失日补 0。UTC 基准对齐 byDay 的 createdAt.slice(0,10)。
 */
function buildDailyTrend(
  byDay: Array<{ day: string; costCny: number; count: number }>,
  since: string | undefined,
  windowDays: number,
): Array<{ day: string; costCny: number; count: number }> {
  if (!byDay.length) return [];
  const map = new Map(byDay.map((d) => [d.day, d]));
  const startYmd = ((since || byDay[0].day) || '').slice(0, 10);
  const startMs = Date.parse(`${startYmd}T00:00:00Z`);
  if (Number.isNaN(startMs)) return byDay;
  const lastMs = Date.parse(`${byDay[byDay.length - 1].day}T00:00:00Z`);
  const spanDays = Number.isNaN(lastMs) ? byDay.length : Math.round((lastMs - startMs) / 86400000) + 1;
  const n = Math.min(370, Math.max(windowDays > 0 ? windowDays : spanDays, spanDays));
  const out: Array<{ day: string; costCny: number; count: number }> = [];
  for (let i = 0; i < n; i++) {
    const key = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
    out.push(map.get(key) || { day: key, costCny: 0, count: 0 });
  }
  return out;
}
