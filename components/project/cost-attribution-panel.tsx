'use client';

/**
 * v9.6.5 — 项目级成本归因面板(阶段十六 T3 性能成本)。拉 /api/projects/[id]/cost
 * (cost_log → engine 归类 → lib/cost-attribution),展示:总成本 + 各类目占比(降序条形)
 * + 最贵类目 + 省钱提示。挂在「技术监看」tab(与性能监看同列)。无成本数据 → 空态提示。
 */
import { useEffect, useMemo, useState } from 'react';
import { CurrencyCny } from '@phosphor-icons/react';
import { evaluateCostGuard } from '@/lib/cost-attribution';

const GUARD_CLS: Record<'none' | 'ok' | 'warn' | 'over', string> = {
  none: 'text-white/40', ok: 'text-emerald-400', warn: 'text-amber-400', over: 'text-rose-400',
};
const GUARD_BAR: Record<'none' | 'ok' | 'warn' | 'over', string> = {
  none: 'bg-white/20', ok: 'bg-emerald-400', warn: 'bg-amber-400', over: 'bg-rose-400',
};

type CostCategory = 'llm' | 'image' | 'video' | 'tts' | 'lipsync' | 'other';
interface CategoryCost { category: CostCategory; label: string; costCny: number; pct: number; count: number; }
interface CostAttribution {
  totalCny: number;
  byCategory: CategoryCost[];
  topCategory: CategoryCost | null;
  hints: string[];
}

const CAT_COLOR: Record<CostCategory, string> = {
  llm: '#8B8BF5', image: '#4DE0C2', video: '#E86A8C', tts: '#E8C547', lipsync: '#5BA8FF', other: '#9AA0AA',
};

const CAP_KEY = (id: string) => `qfmj-cost-cap-${id}`;

export function CostAttributionPanel({ projectId }: { projectId: string }) {
  const [attr, setAttr] = useState<CostAttribution | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cap, setCap] = useState('');

  useEffect(() => {
    let alive = true;
    try { const v = localStorage.getItem(CAP_KEY(projectId)); if (v) setCap(v); } catch { /* ignore */ }
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cost`);
        const body = await res.json();
        if (alive && res.ok) setAttr(body.attribution as CostAttribution);
      } catch { /* 静默:增强信息 */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const capNum = cap.trim() !== '' && Number.isFinite(Number(cap)) ? Number(cap) : null;
  const guard = useMemo(() => evaluateCostGuard({ totalCny: attr?.totalCny || 0, capCny: capNum }), [attr, capNum]);
  const onCapChange = (v: string) => {
    setCap(v);
    try { if (v.trim()) localStorage.setItem(CAP_KEY(projectId), v); else localStorage.removeItem(CAP_KEY(projectId)); } catch { /* ignore */ }
  };

  if (!loaded) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
          <CurrencyCny className="w-4 h-4" /> 成本归因 · 这一单花在哪
        </div>
        {attr && attr.totalCny > 0 && (
          <span className="text-[13px] text-white/85 font-semibold tabular-nums">¥{attr.totalCny.toFixed(2)}</span>
        )}
      </div>

      {!attr || attr.totalCny === 0 ? (
        <div className="text-[12px] text-white/40 py-4 text-center">暂无成本数据 —— 生成成片后即可看每阶段花销与省钱建议</div>
      ) : (
        <>
          {/* v9.7.17 预算护栏 */}
          <div className="mb-3 rounded-lg bg-white/[0.03] border border-white/5 p-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] text-white/50">预算上限 ¥</span>
              <input
                type="number" min="0" inputMode="decimal" value={cap}
                onChange={(e) => onCapChange(e.target.value)} placeholder="未设"
                className="w-20 bg-white/[0.05] border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/80 text-right outline-none"
              />
            </div>
            {guard.level !== 'none' && (
              <>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className={`h-full rounded-full ${GUARD_BAR[guard.level]}`} style={{ width: `${Math.min(100, guard.pctUsed || 0)}%` }} />
                </div>
                <div className={`text-[11px] mt-1 ${GUARD_CLS[guard.level]}`}>{guard.message}</div>
              </>
            )}
          </div>

          {/* 各类目占比条 */}
          <div className="space-y-2 mb-3">
            {attr.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-2.5">
                <span className="text-[11px] text-white/60 w-20 shrink-0 truncate">{c.label}</span>
                <div className="flex-1 min-w-0 h-3 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, c.pct)}%`, backgroundColor: CAT_COLOR[c.category] }} />
                </div>
                <span className="text-[11px] text-white/50 w-10 shrink-0 text-right tabular-nums">{c.pct}%</span>
                <span className="text-[11px] text-white/70 w-14 shrink-0 text-right tabular-nums">¥{c.costCny.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* 省钱提示 */}
          <div className="space-y-1">
            {attr.hints.map((h, i) => (
              <div key={i} className="text-[11px] text-white/45 flex gap-1.5">
                <span className="text-amber-300/50">💡</span>{h}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
