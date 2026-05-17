'use client';

/**
 * v2.21 P1.4 — 节奏分析图 (PacingChart).
 *
 * 展示 lib/pacing-audit.ts 的 PacingAuditReport:
 *   - 顶部 KPI: 平均冲突分 / 反转数 / 通过/不通过
 *   - 主图: 每镜的 conflict score (色带 + 极性图标 + 反转箭头)
 *   - 底部: warnings + suggestions 列表
 *
 * 设计原则:
 *   - 一眼能看出 "哪一镜偏弱" — 颜色编码 + hover title
 *   - 看不到具体数据时退化优雅 (空报告也能渲染骨架)
 */

import { ArrowRight, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Minus, Lightbulb } from 'lucide-react';

type Polarity = -1 | 0 | 1;

interface ShotReport {
  shotNumber: number;
  conflictScore: number;
  polarity: Polarity;
  warning: string | null;
}

interface PacingReport {
  dramaMode: boolean;
  averageConflictScore: number;
  reversalCount: number;
  reversalDensity: number;
  passed: boolean;
  shots: ShotReport[];
  warnings: string[];
  suggestions: string[];
}

export interface PacingChartProps {
  report: PacingReport | null | undefined;
}

function scoreColor(score: number): string {
  if (score >= 7) return 'var(--cinema-green)';
  if (score >= 4) return 'var(--cinema-amber)';
  return 'var(--cinema-red)';
}

function PolarityIcon({ p }: { p: Polarity }) {
  if (p === 1) return <TrendingUp className="w-3 h-3" style={{ color: 'var(--cinema-green)' }} />;
  if (p === -1) return <TrendingDown className="w-3 h-3" style={{ color: 'var(--cinema-red)' }} />;
  return <Minus className="w-3 h-3 opacity-40" />;
}

export function PacingChart({ report }: PacingChartProps) {
  if (!report) {
    return (
      <div className="cinema-card-hi p-6 text-center">
        <div className="cinema-mono text-[11px] opacity-50">
          暂无节奏数据 — 等编剧完成本项目后这里会显示节奏分析
        </div>
      </div>
    );
  }

  const { shots, averageConflictScore, reversalCount, passed, dramaMode, warnings, suggestions } = report;

  // 反转对 — 把相邻不同极性的 shot 标出来
  const reversalEdges = new Set<number>();
  let lastNonZero: { idx: number; polarity: Polarity } | null = null;
  for (let i = 0; i < shots.length; i++) {
    const p = shots[i].polarity;
    if (p === 0) continue;
    if (lastNonZero && p !== lastNonZero.polarity) {
      reversalEdges.add(lastNonZero.idx); // 标在前一镜的右边
    }
    lastNonZero = { idx: i, polarity: p };
  }

  return (
    <div className="space-y-4">
      {/* KPI 卡 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="cinema-card-hi p-3">
          <div className="cinema-eyebrow mb-1">AVG CONFLICT</div>
          <div className="flex items-baseline gap-1">
            <span className="cinema-headline text-2xl" style={{ color: scoreColor(averageConflictScore) }}>
              {averageConflictScore.toFixed(1)}
            </span>
            <span className="cinema-mono text-[10px] opacity-50">/10</span>
          </div>
          <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
            {dramaMode ? '短剧 ≥3.5 合格' : '普通 ≥2.5 合格'}
          </div>
        </div>

        <div className="cinema-card-hi p-3">
          <div className="cinema-eyebrow mb-1">REVERSALS</div>
          <div className="flex items-baseline gap-1">
            <span className="cinema-headline text-2xl">{reversalCount}</span>
            <span className="cinema-mono text-[10px] opacity-50">次</span>
          </div>
          <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
            {dramaMode ? '短剧 ≥2 合格' : '普通 ≥1 合格'}
          </div>
        </div>

        <div className="cinema-card-hi p-3">
          <div className="cinema-eyebrow mb-1">VERDICT</div>
          <div className="flex items-center gap-1.5">
            {passed ? (
              <>
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--cinema-green)' }} />
                <span className="cinema-headline text-base" style={{ color: 'var(--cinema-green)' }}>通过</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5" style={{ color: 'var(--cinema-amber)' }} />
                <span className="cinema-headline text-base" style={{ color: 'var(--cinema-amber)' }}>待改</span>
              </>
            )}
          </div>
          <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
            {dramaMode ? '短剧模式' : '普通模式'}
          </div>
        </div>
      </div>

      {/* 每镜柱状条 + 反转箭头 */}
      <div className="cinema-card-hi p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="cinema-eyebrow">PER-SHOT CONFLICT</div>
          <div className="cinema-mono text-[10px] opacity-50">
            {shots.length} 镜
          </div>
        </div>
        {shots.length === 0 ? (
          <div className="cinema-mono text-[11px] opacity-50 py-4 text-center">
            无镜头数据
          </div>
        ) : (
          <div className="flex items-end gap-1 min-h-[140px]">
            {shots.map((s, i) => {
              const heightPct = Math.max(8, (s.conflictScore / 10) * 100);
              const color = scoreColor(s.conflictScore);
              const isReversal = reversalEdges.has(i);
              return (
                <div key={s.shotNumber} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  {/* 反转箭头 — 标在该镜柱顶之上 */}
                  <div className="h-4 flex items-center justify-center">
                    {isReversal && (
                      <ArrowRight
                        className="w-3 h-3"
                        style={{ color: 'var(--cinema-amber)' }}
                        aria-label="情绪反转"
                      />
                    )}
                  </div>
                  {/* 极性 icon */}
                  <PolarityIcon p={s.polarity} />
                  {/* 柱条 */}
                  <div
                    className="w-full rounded-t flex items-end justify-center relative group"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: '12px',
                      background: color,
                      opacity: s.warning ? 0.6 : 0.9,
                    }}
                    title={s.warning ?? `Shot ${s.shotNumber}: ${s.conflictScore}/10`}
                  >
                    <span className="cinema-mono text-[9px] text-black/70 font-bold pb-0.5">
                      {s.conflictScore}
                    </span>
                  </div>
                  {/* 镜号 */}
                  <div className="cinema-mono text-[10px] opacity-60">{s.shotNumber}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-3 mt-3 cinema-mono text-[9px] opacity-50">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-green)' }} /> 强 ≥7
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-amber)' }} /> 中 4-6
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-red)' }} /> 弱 &lt;4
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <ArrowRight className="w-2.5 h-2.5" style={{ color: 'var(--cinema-amber)' }} /> 情绪反转点
          </span>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="cinema-card-hi p-4 border-[var(--cinema-amber)]/40">
          <div className="cinema-eyebrow mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            WARNINGS ({warnings.length})
          </div>
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="cinema-mono text-[11px] leading-relaxed">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="cinema-card-hi p-4">
          <div className="cinema-eyebrow mb-2 flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" />
            SUGGESTIONS ({suggestions.length})
          </div>
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={i} className="cinema-mono text-[11px] leading-relaxed opacity-80">
                · {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
