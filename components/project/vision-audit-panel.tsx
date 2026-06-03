'use client';

/**
 * v3.4 — Vision Audit 面板 (VisionAuditPanel).
 *
 * 展示端到端成片质检结果: 全片 verdict + 平均分 + pass/warn/fail 统计 +
 * 最差镜快捷跳转 + 每镜维度分 (场景/动作/情绪/构图) + 问题列表.
 *
 * 纯展示组件 — 数据由父组件从 /api/projects/[id]/vision-audit 拿后传入.
 */

import { Warning as AlertTriangle, CheckCircle as CheckCircle2, XCircle, Eye, FilmStrip as Film, ArrowsClockwise } from '@phosphor-icons/react';
import { buildRebirthPlan } from '@/lib/rebirth-plan';

export interface VisionAuditShot {
  shotNumber: number;
  score: number;
  verdict: 'pass' | 'warn' | 'fail';
  dimensions: {
    sceneMatch: number;
    actionMatch: number;
    moodMatch: number;
    composition: number;
  };
  issues: string[];
  reasoning: string;
}

export interface VisionAuditSummaryShape {
  avgScore: number;
  shotCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  weakestShots: Array<{ shotNumber: number; score: number }>;
  verdict: 'excellent' | 'good' | 'needs-work' | 'poor';
}

export interface VisionAuditPanelProps {
  audits: VisionAuditShot[];
  summary: VisionAuditSummaryShape | null | undefined;
  /** 点击某镜 (跳转 / 触发重生) 回调. */
  onShotClick?: (shotNumber: number) => void;
  /** v9.4.2: 「一键重拍弱镜」批量入口 (把低分镜列表交给父组件, 通常跳镜头工坊重拍). */
  onReshootWeak?: (shotNumbers: number[]) => void;
}

const VERDICT_LABEL: Record<VisionAuditSummaryShape['verdict'], string> = {
  excellent: '优秀',
  good: '良好',
  'needs-work': '待优化',
  poor: '需重做',
};

const VERDICT_COLOR: Record<VisionAuditSummaryShape['verdict'], string> = {
  excellent: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  good: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  'needs-work': 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  poor: 'text-rose-400 border-rose-500/40 bg-rose-500/10',
};

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function barColor(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function VerdictIcon({ verdict }: { verdict: VisionAuditShot['verdict'] }) {
  if (verdict === 'pass') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (verdict === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <XCircle className="w-4 h-4 text-rose-400" />;
}

function DimBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-white/50 w-8 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${barColor(value)}`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[11px] tabular-nums w-7 text-right ${scoreColor(value)}`}>{value}</span>
    </div>
  );
}

export function VisionAuditPanel({ audits, summary, onShotClick, onReshootWeak }: VisionAuditPanelProps) {
  const rebirthPlan = buildRebirthPlan(audits);
  if (!summary || summary.shotCount === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-white/50 text-sm">
        <Eye className="w-8 h-8 mx-auto mb-2 opacity-40" />
        还没有成片质检数据。生成成片后即可对每镜画面做"是否对得上剧本"的 AI 评分。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 总览 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
            <Film className="w-4 h-4" /> 成片质检 · 画面 vs 剧本
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${VERDICT_COLOR[summary.verdict]}`}>
            {VERDICT_LABEL[summary.verdict]}
          </span>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <div className={`text-3xl font-bold tabular-nums ${scoreColor(summary.avgScore)}`}>{summary.avgScore}</div>
            <div className="text-[11px] text-white/40">平均分 / {summary.shotCount} 镜</div>
          </div>
          <div className="flex gap-3 text-xs pb-1">
            <span className="text-emerald-400">{summary.passCount} 通过</span>
            <span className="text-amber-400">{summary.warnCount} 偏差</span>
            <span className="text-rose-400">{summary.failCount} 跑题</span>
          </div>
        </div>

        {summary.weakestShots.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="text-[11px] text-white/40 mb-1.5">最需关注 (优先重生):</div>
            <div className="flex flex-wrap gap-1.5">
              {summary.weakestShots.map((w) => (
                <button
                  key={w.shotNumber}
                  onClick={() => onShotClick?.(w.shotNumber)}
                  className="px-2 py-0.5 rounded-md text-xs border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors"
                >
                  镜 {w.shotNumber} · {w.score}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* v9.4.2: 重生计划 — 低分镜按优先级 + 针对性修补提示 */}
      {rebirthPlan.count > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
              <ArrowsClockwise className="w-4 h-4" /> 重生计划 · {rebirthPlan.count} 个弱镜建议重拍
            </div>
            {onReshootWeak && (
              <button
                onClick={() => onReshootWeak(rebirthPlan.shots.map((s) => s.shotNumber))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25 transition-colors inline-flex items-center gap-1.5"
              >
                <ArrowsClockwise className="w-3.5 h-3.5" /> 一键去工坊重拍
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {rebirthPlan.shots.map((s) => (
              <button
                key={s.shotNumber}
                onClick={() => onShotClick?.(s.shotNumber)}
                className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-black/20 border border-white/5 hover:border-amber-500/30 transition-colors"
              >
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold flex items-center justify-center tabular-nums">{s.priority}</span>
                <span className="shrink-0 text-xs text-white/70 mt-0.5">镜 {s.shotNumber}</span>
                <span className={`shrink-0 text-xs font-semibold tabular-nums mt-0.5 ${scoreColor(s.score)}`}>{s.score}</span>
                <span className="text-[11px] text-white/55 leading-relaxed">{s.focusHint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 逐镜 */}
      <div className="space-y-2">
        {audits.map((a) => (
          <div
            key={a.shotNumber}
            className="rounded-lg border border-white/10 bg-white/5 p-3 hover:border-white/20 transition-colors cursor-pointer"
            onClick={() => onShotClick?.(a.shotNumber)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <VerdictIcon verdict={a.verdict} />
                <span className="text-sm text-white/80">镜 {a.shotNumber}</span>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${scoreColor(a.score)}`}>{a.score}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <DimBar label="场景" value={a.dimensions.sceneMatch} />
              <DimBar label="动作" value={a.dimensions.actionMatch} />
              <DimBar label="情绪" value={a.dimensions.moodMatch} />
              <DimBar label="构图" value={a.dimensions.composition} />
            </div>
            {a.issues.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {a.issues.map((issue, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[11px] bg-rose-500/10 text-rose-300/90 border border-rose-500/20">
                    {issue}
                  </span>
                ))}
              </div>
            )}
            {a.reasoning && <div className="mt-1.5 text-[11px] text-white/40">{a.reasoning}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
