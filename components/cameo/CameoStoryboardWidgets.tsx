'use client';

/**
 * CameoStoryboardWidgets — 分镜 tab 上的 Cameo 一致性可视化套件 (Sprint A.4)
 *
 * 三个组件:
 *   · CameoBadge      — 单张分镜卡右上角的红/黄/绿小圆 (含 popover 显示详情)
 *   · CameoSummary    — 项目顶部汇总条 (N 镜 · 平均 · 需重生)
 *   · CameoBatchRetry — "批量重生低分镜" 按钮 + 进度反馈
 *
 * 数据契约:
 *   每个 storyboard asset 的 data 字段包含可选的 cameoScore/cameoRetried/...,
 *   由 v2.12 Sprint A.1 的 evaluateAndRetry 在 orchestrator 写入并经 create-stream 落库.
 *   对没有 cameoScore 的旧数据, 所有组件都做 noop / 空态 friendly 渲染。
 *
 * 设计目的: 从 ROADMAP_V4 的"5 秒判断哪些镜要重画"出发, 顶部一行总览,
 *           每张卡角标精确定位, 一键批量重生闭环。
 */

import { useState, useMemo } from 'react';
import { Activity, Repeat, AlertTriangle, Loader2, CheckCircle2, X } from 'lucide-react';

interface CameoData {
  cameoScore?: number;
  cameoRetried?: boolean;
  cameoAttempts?: number;
  cameoFinalCw?: number;
  cameoReason?: string;
  /** v2.12 Phase 3 → A.4: 多角色锁脸独立评分,2+ 角色镜头才有。null score = 该角色 vision 失败 */
  cameoPerCharacterScores?: Array<{ name?: string; score: number | null; reasoning?: string }>;
}

/** 把 0-100 分映射成 red / amber / green 三档配色, 与 readinessLevel 对齐 */
function classify(score?: number): 'green' | 'amber' | 'red' | 'na' {
  if (typeof score !== 'number') return 'na';
  if (score >= 85) return 'green';
  if (score >= 70) return 'amber';  // 注意 ROADMAP_V4 §2 A.4 说 70-84 黄, 75 是 retry 阈值, 这里展示用 70 边界
  return 'red';
}

const PALETTE = {
  green: { dot: 'bg-emerald-400', text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/35' },
  amber: { dot: 'bg-amber-400',   text: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-500/35' },
  red:   { dot: 'bg-rose-400',    text: 'text-rose-300',    bg: 'bg-rose-500/15',    border: 'border-rose-500/35' },
  na:    { dot: 'bg-white/15',    text: 'text-white/40',    bg: 'bg-white/5',        border: 'border-white/10' },
} as const;

// ────────────────────────────────────────────────
// Badge — 单张分镜卡角标
// ────────────────────────────────────────────────

export function CameoBadge({ data }: { data: CameoData }) {
  const [showPopover, setShowPopover] = useState(false);
  const lvl = classify(data.cameoScore);
  // 没分数也不渲染 (避免空徽章污染卡片)
  if (lvl === 'na' && !data.cameoRetried) return null;

  const p = PALETTE[lvl];

  return (
    <div className="absolute top-2 right-2 z-10">
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowPopover((v) => !v); }}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border backdrop-blur-sm shadow-sm hover:scale-105 transition-transform ${p.bg} ${p.text} ${p.border}`}
        aria-label={`Cameo 一致性: ${data.cameoScore ?? '—'}/100`}
        title={`Cameo 一致性: ${data.cameoScore ?? '—'}/100`}
      >
        <Activity className="w-2.5 h-2.5" />
        {typeof data.cameoScore === 'number' ? data.cameoScore : '—'}
        {data.cameoRetried ? <Repeat className="w-2.5 h-2.5 ml-0.5 opacity-80" /> : null}
      </button>

      {showPopover ? (
        <>
          {/* 半透明遮罩抓 click-outside */}
          <div
            className="fixed inset-0 z-30"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowPopover(false); }}
          />
          <div
            className={`absolute right-0 mt-1.5 w-56 rounded-lg border ${p.border} bg-[#0E0E10]/97 shadow-2xl backdrop-blur z-40 p-3 text-left`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[11px] tracking-widest uppercase ${p.text}`}>Cameo 一致性</span>
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowPopover(false); }}
                className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <div className="flex items-end gap-1 mb-2">
              <span className={`text-2xl font-bold ${p.text} tabular-nums leading-none`}>
                {typeof data.cameoScore === 'number' ? data.cameoScore : '—'}
              </span>
              <span className="text-[10px] text-white/40 mb-0.5">/ 100</span>
            </div>

            {/* v2.12 Phase 3: 多角色独立评分条 — 仅当 cameoPerCharacterScores 有 2+ 条时显示 */}
            {data.cameoPerCharacterScores && data.cameoPerCharacterScores.length >= 2 ? (
              <div className="mb-2 pb-2 border-b border-white/10">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">
                  per-character ({data.cameoPerCharacterScores.length})
                </div>
                <ul className="space-y-1.5">
                  {data.cameoPerCharacterScores.map((c, i) => {
                    const lvl = classify(c.score == null ? undefined : c.score);
                    const cp = PALETTE[lvl];
                    const widthPct = c.score == null ? 0 : Math.max(2, Math.min(100, c.score));
                    return (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-[10.5px] text-white/65 truncate flex-shrink-0 max-w-[80px]" title={c.name || `角色 ${i + 1}`}>
                          {c.name || `#${i + 1}`}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                          <div
                            className={`h-full ${cp.dot} transition-all`}
                            style={{ width: `${widthPct}%`, opacity: c.score == null ? 0.2 : 1 }}
                          />
                        </div>
                        <span className={`text-[10.5px] font-semibold tabular-nums ${cp.text} flex-shrink-0 w-8 text-right`}>
                          {c.score == null ? '—' : c.score}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {data.cameoReason ? (
              <p className="text-[11px] text-white/70 leading-relaxed mb-2 italic">"{data.cameoReason}"</p>
            ) : null}

            <ul className="space-y-1 text-[10.5px] text-white/55">
              {data.cameoRetried ? (
                <li className="flex items-center gap-1.5">
                  <Repeat className="w-3 h-3 text-violet-300" />
                  <span>已自动重生 {data.cameoAttempts ?? 2} 次</span>
                </li>
              ) : (
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-white/40" />
                  <span>首次生成达标</span>
                </li>
              )}
              {typeof data.cameoFinalCw === 'number' ? (
                <li className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-white/40" />
                  <span>最终 cw = {data.cameoFinalCw}</span>
                </li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────
// Summary Bar — 项目顶部汇总
// ────────────────────────────────────────────────

export function CameoSummary({
  storyboards, onBatchRetry, batchRetrying,
}: {
  storyboards: Array<{ data?: CameoData; shotNumber?: number }>;
  onBatchRetry: (lowScoreShotNumbers: number[]) => void;
  batchRetrying: boolean;
}) {
  const stats = useMemo(() => {
    const scored = storyboards.filter((sb) => typeof sb.data?.cameoScore === 'number');
    const total = storyboards.length;
    const evaluated = scored.length;
    if (evaluated === 0) {
      return { total, evaluated: 0, avg: null, lowCount: 0, retriedCount: 0, lowShotNumbers: [] as number[] };
    }
    const sum = scored.reduce((s, sb) => s + (sb.data!.cameoScore ?? 0), 0);
    const avg = Math.round(sum / evaluated);
    const lowShots = scored.filter((sb) => (sb.data!.cameoScore ?? 100) < 75);
    const retried = scored.filter((sb) => sb.data!.cameoRetried).length;
    return {
      total,
      evaluated,
      avg,
      lowCount: lowShots.length,
      retriedCount: retried,
      lowShotNumbers: lowShots.map((sb) => sb.shotNumber ?? 0).filter((n) => n > 0),
    };
  }, [storyboards]);

  // 没有任何评分数据 → 不渲染汇总条 (避免空态污染)
  if (stats.evaluated === 0) {
    if (stats.total > 0) {
      return (
        <div className="mb-3 px-3 py-2 rounded-lg bg-white/3 border border-white/8 text-[11px] text-white/45 leading-relaxed">
          本项目分镜暂无 Cameo 一致性评分(早于 v2.12 创建 / 未配置 OPENAI_API_KEY)
        </div>
      );
    }
    return null;
  }

  const avgLvl = classify(stats.avg ?? undefined);
  const ap = PALETTE[avgLvl];

  return (
    <div className="mb-3 flex items-center gap-3 flex-wrap px-3 py-2.5 rounded-lg bg-gradient-to-r from-violet-500/8 to-rose-500/5 border border-violet-500/20">
      <div className="flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-[11px] text-violet-200 tracking-widest uppercase">Cameo 一致性</span>
      </div>
      <div className="text-[12px] text-white/85">
        本项目 <span className="font-semibold tabular-nums">{stats.total}</span> 镜
      </div>
      <div className="flex items-center gap-1 text-[12px]">
        <span className="text-white/50">平均</span>
        <span className={`font-bold tabular-nums ${ap.text}`}>{stats.avg}</span>
        <span className="text-white/30 text-[10px]">/100</span>
      </div>
      {stats.lowCount > 0 ? (
        <div className="flex items-center gap-1 text-[12px] text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            <span className="font-semibold tabular-nums">{stats.lowCount}</span> 镜需重生
          </span>
        </div>
      ) : null}
      {stats.retriedCount > 0 ? (
        <div className="flex items-center gap-1 text-[11px] text-violet-200/70">
          <Repeat className="w-3 h-3" />
          <span>本次已自动重生 {stats.retriedCount} 镜</span>
        </div>
      ) : null}
      {stats.lowCount > 0 ? (
        <button
          onClick={() => onBatchRetry(stats.lowShotNumbers)}
          disabled={batchRetrying}
          className="ml-auto px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11.5px] text-violet-100 border border-violet-500/35 transition-colors flex items-center gap-1.5"
          title={`触发 cameo 自动重生流程, 加强 cw 重画这 ${stats.lowCount} 镜`}
        >
          {batchRetrying ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              重生中…
            </>
          ) : (
            <>
              <Repeat className="w-3.5 h-3.5" />
              批量重生 ({stats.lowCount})
            </>
          )}
        </button>
      ) : (
        <span className="ml-auto text-[10.5px] text-emerald-300/70">✓ 所有镜头已达标</span>
      )}
    </div>
  );
}
