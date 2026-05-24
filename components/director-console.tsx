'use client';

/**
 * v6.4 — 导演台 (Director Console). 把创作主流程 4 环节 (剧本→资产→分镜→成片) 可视化:
 * 每环节状态 (未生成/就绪/待更新) + 进入编辑 + 重跑下游影响提示. 纯逻辑在 lib/pipeline-stages.
 */

import { useState } from 'react';
import { FileText, Users, Clapperboard, Film, Pencil, RefreshCw, AlertTriangle, ChevronRight, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import {
  derivePipelineStages, downstreamStages, pipelineProgress,
  PIPELINE_STAGES, type StageAsset, type StageId, type StageStatus,
} from '@/lib/pipeline-stages';

const STAGE_ICON: Record<StageId, typeof FileText> = {
  script: FileText, assets: Users, storyboard: Clapperboard, final: Film,
};
const STATUS_META: Record<StageStatus, { label: string; cls: string }> = {
  empty: { label: '未生成', cls: 'text-[var(--muted)] bg-white/5 border-white/10' },
  ready: { label: '就绪', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
  stale: { label: '待更新', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
};
const stageLabel = (id: StageId) => PIPELINE_STAGES.find((s) => s.id === id)?.label ?? id;

export function DirectorConsole({
  assets,
  onEditStage,
  projectId,
  onReran,
}: {
  assets: StageAsset[];
  onEditStage: (tab: string) => void;
  /** v6.4.1: 提供后「重跑」按钮真调 /api/projects/[id]/rerun */
  projectId?: string;
  /** v6.4.1: 重跑落库后回调 (刷新项目数据) */
  onReran?: () => void;
}) {
  const stages = derivePipelineStages(assets);
  const prog = pipelineProgress(stages);
  const [impact, setImpact] = useState<StageId | null>(null);
  const [rerunning, setRerunning] = useState<StageId | null>(null);
  const [rerunMsg, setRerunMsg] = useState('');

  const doRerun = async (sid: StageId) => {
    if (!projectId) return;
    setRerunning(sid); setRerunMsg('');
    try {
      const res = await fetch(`/api/projects/${projectId}/rerun`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: sid }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '重跑失败');
      const n = d.plan?.invalidates?.length ?? 0;
      setRerunMsg(
        d.dispatched
          ? `✓ 已重跑「${stageLabel(sid)}」并派发管线重生`
          : `✓ 已标记「${stageLabel(sid)}」重跑${n ? `,下游 ${n} 环节置为待更新` : ''}`,
      );
      setImpact(null);
      onReran?.();
    } catch (e: any) {
      setRerunMsg(e?.message || '重跑失败');
    } finally {
      setRerunning(null);
      setTimeout(() => setRerunMsg(''), 4000);
    }
  };

  return (
    <div className="cinema-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><Clapperboard className="w-4 h-4 text-[#E8C547]" />导演台 · 全链路控片</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">逐环节查看状态 · 进入任意节点编辑 / 重生 · 了解重跑的下游影响</p>
        </div>
        <span className="text-[11px] text-[var(--muted)]">产出 {prog.produced}/{prog.total} 环节</span>
      </div>

      {/* 进度条 */}
      <div className={`h-1.5 rounded-full bg-white/10 overflow-hidden ${rerunMsg ? 'mb-2' : 'mb-5'}`}>
        <div className="h-full bg-gradient-to-r from-[#E8C547] to-[#D4A830] transition-all" style={{ width: `${prog.pct}%` }} />
      </div>
      {rerunMsg && <p className="text-[11px] text-amber-300 mb-4">{rerunMsg}</p>}

      {/* 环节流水线 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stages.map((s, i) => {
          const Icon = STAGE_ICON[s.id];
          const meta = STATUS_META[s.status];
          const down = downstreamStages(s.id);
          return (
            <div key={s.id} className="relative rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 flex flex-col">
              {/* 连接箭头 (大屏) */}
              {i < stages.length - 1 && (
                <ChevronRight className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--soft)] z-10" />
              )}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl grid place-items-center ${s.status === 'empty' ? 'bg-white/5 text-[var(--muted)]' : 'bg-[#E8C547]/15 text-[#E8C547]'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{s.label}</div>
                    <div className="text-[10px] text-[var(--soft)]">{s.desc}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] border ${meta.cls}`}>{meta.label}</span>
                {s.count > 0 && <span className="text-[10px] text-[var(--muted)]">{s.count} 项</span>}
              </div>

              {s.status === 'stale' && (
                <p className="text-[10px] text-amber-300/90 flex items-start gap-1 mb-2">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />上游已更新,建议重生本环节
                </p>
              )}

              <div className="mt-auto flex gap-1.5">
                <button
                  onClick={() => onEditStage(s.editTab)}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/85 border border-white/10 hover:bg-white/10 transition-all"
                >
                  <Pencil className="w-3 h-3" />{s.status === 'empty' ? '生成' : '编辑'}
                </button>
                {s.status !== 'empty' && (
                  <button
                    onClick={() => setImpact(impact === s.id ? null : s.id)}
                    title="重跑此环节"
                    className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] bg-amber-500/10 text-amber-300 border border-amber-500/25 hover:bg-amber-500/20 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" />重跑
                  </button>
                )}
              </div>

              {impact === s.id && s.status !== 'empty' && (
                <div className="mt-2 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2">
                  <p className="text-[10px] text-amber-300/90 leading-relaxed">
                    {down.length > 0
                      ? <>重跑「{s.label}」后,下游需重新生成:{down.map(stageLabel).join(' → ')}</>
                      : <>重跑「{s.label}」(末环节,无下游影响)</>}
                  </p>
                  {projectId && (
                    <button
                      onClick={() => doRerun(s.id)}
                      disabled={rerunning === s.id}
                      className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {rerunning === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      确认重跑此环节
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
