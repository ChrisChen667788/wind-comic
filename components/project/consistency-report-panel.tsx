'use client';

/**
 * v9.4.5 — 项目级一致性报告面板。拉 /api/projects/[id]/consistency(lib/consistency-report 聚合),
 * 展示连贯/光影/脸 3 维的最新分 + 跨轮 sparkline + 趋势箭头 + 最弱维。挂在「成片质检」tab。
 */
import { useEffect, useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';

type DimKey = 'continuity' | 'lighting' | 'face';
interface Trend { dimension: DimKey; label: string; latest: number; first: number; delta: number; direction: 'up' | 'down' | 'flat'; }
interface Report {
  rounds: number;
  latest: { overall: number; continuity: number; lighting: number; face: number } | null;
  trends: Trend[];
  weakest: { dimension: DimKey; label: string; score: number } | null;
  series: { overall: number; continuity: number; lighting: number; face: number }[];
  message: string;
}

const DIM_COLOR: Record<DimKey, string> = { continuity: '#5BA8FF', lighting: '#E8C547', face: '#4DE0C2' };

function scoreColor(s: number): string {
  if (s >= 75) return 'text-emerald-400';
  if (s >= 50) return 'text-amber-400';
  return 'text-rose-400';
}
function arrow(d: Trend['direction']): { ch: string; cls: string } {
  if (d === 'up') return { ch: '↑', cls: 'text-emerald-400' };
  if (d === 'down') return { ch: '↓', cls: 'text-rose-400' };
  return { ch: '→', cls: 'text-white/40' };
}

export function ConsistencyReportPanel({ projectId, refreshKey }: { projectId: string; refreshKey?: number }) {
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/consistency`);
        const body = await res.json();
        if (alive && res.ok) setReport(body.report as Report);
      } catch { /* 静默:增强信息 */ }
    })();
    return () => { alive = false; };
  }, [projectId, refreshKey]);

  if (!report || report.rounds === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
          <ChartBar className="w-4 h-4" /> 一致性趋势 · {report.rounds} 轮
        </div>
        {report.weakest && (
          <span className="text-[11px] text-white/45">最弱:{report.weakest.label} {report.weakest.score}</span>
        )}
      </div>

      <div className="space-y-2.5">
        {report.trends.map((t) => {
          const a = arrow(t.direction);
          return (
            <div key={t.dimension} className="flex items-center gap-3">
              <span className="text-xs text-white/60 w-12 shrink-0">{t.label}</span>
              {/* sparkline: 每轮一根小柱(旧→新) */}
              <div className="flex items-end gap-0.5 h-7 flex-1 min-w-0">
                {report.series.map((s, i) => (
                  <div
                    key={i}
                    className="flex-1 min-w-[2px] rounded-sm"
                    style={{ height: `${Math.max(6, Math.min(100, s[t.dimension]))}%`, backgroundColor: DIM_COLOR[t.dimension], opacity: i === report.series.length - 1 ? 1 : 0.4 }}
                    title={`第 ${i + 1} 轮:${s[t.dimension]}`}
                  />
                ))}
              </div>
              <span className={`text-sm font-semibold tabular-nums w-8 text-right ${scoreColor(t.latest)}`}>{t.latest}</span>
              {report.rounds > 1 && (
                <span className={`text-[11px] tabular-nums w-10 text-right ${a.cls}`}>
                  {a.ch}{t.delta > 0 ? '+' : ''}{t.delta}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-white/45">{report.message}</p>
    </div>
  );
}
