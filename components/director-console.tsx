'use client';

/**
 * v6.4 — 导演台 (Director Console). v12.44 仪表盘化:顶部 KPI 概览(完成度/分镜/视频/成片)
 * + 下一步建议徽章 + cinema-meter 进度 + 创作主流程 4 环节(剧本→资产→分镜→成片)流水线
 * (状态/进编辑/重跑下游影响)。纯逻辑在 lib/pipeline-stages;全量 cinema 设计系统。
 */

import { useState } from 'react';
import {
  FileText, Users, FilmSlate as Clapperboard, FilmStrip as Film, Pencil,
  ArrowsClockwise as RefreshCw, Warning as AlertTriangle, CaretRight as ChevronRight,
  CheckCircle as CheckCircle2, CircleNotch as Loader2, Lightning,
} from '@phosphor-icons/react';
import {
  derivePipelineStages, downstreamStages, pipelineProgress,
  PIPELINE_STAGES, type StageAsset, type StageId, type StageStatus,
} from '@/lib/pipeline-stages';

const STAGE_ICON: Record<StageId, typeof FileText> = {
  script: FileText, assets: Users, storyboard: Clapperboard, final: Film,
};
const STATUS_META: Record<StageStatus, { label: string; chip: string }> = {
  empty: { label: '未生成', chip: 'cinema-chip' },
  ready: { label: '就绪', chip: 'cinema-chip cinema-chip-green' },
  stale: { label: '待更新', chip: 'cinema-chip cinema-chip-amber' },
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
  // v12.100:一键广告包装车间(hook 弹药→变体+双卡→文案→并包)
  const [workshopBusy, setWorkshopBusy] = useState(false);
  const [workshopMsg, setWorkshopMsg] = useState('');

  // v12.44: 从 assets 按类型派生 KPI 概览
  const cnt = (t: string) => (assets as Array<{ type?: string }>).filter((a) => a?.type === t).length;
  const kpis: Array<{ label: string; value: string; sub: string }> = [
    { label: 'PROGRESS', value: `${prog.pct}%`, sub: `${prog.produced}/${prog.total} 环节` },
    { label: 'SHOTS', value: String(cnt('storyboard')), sub: '分镜' },
    { label: 'CLIPS', value: String(cnt('video')), sub: '镜头视频' },
    { label: 'FILM', value: cnt('final_video') > 0 ? '✓' : '—', sub: '成片' },
  ];
  const nextStage = stages.find((s) => s.status === 'empty') || stages.find((s) => s.status === 'stale');
  const nextHint = nextStage
    ? (nextStage.status === 'empty' ? `下一步 · 生成「${nextStage.label}」` : `建议 · 重生「${nextStage.label}」`)
    : '全链路就绪 · 可导出成片';

  const doWorkshop = async () => {
    if (!projectId || workshopBusy) return;
    setWorkshopBusy(true); setWorkshopMsg('包装中…(hook→变体→文案→并包,约 1-3 分钟)');
    try {
      const res = await fetch(`/api/projects/${projectId}/ad-workshop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'douyin', aspect: '9:16' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '包装失败');
      const st = d.steps || {};
      setWorkshopMsg(
        `✓ 包装 ${d.okSteps}/${d.totalSteps}:` +
        `${st.hookIdeas?.ok ? ` Hook×${(st.hookIdeas.hooks || []).length}` : ' Hook✗'}` +
        `${st.recompose?.ok ? ` · 变体×${(st.recompose.variants || []).length}` : ' · 合成✗'}` +
        `${st.publishCopy?.ok ? ' · 文案✓' : ' · 文案✗'}` +
        `${st.package?.ok ? ' · 并包✓' : ' · 并包✗'}`,
      );
      onReran?.();
    } catch (e: unknown) {
      setWorkshopMsg(e instanceof Error ? e.message : '包装失败');
    } finally {
      setWorkshopBusy(false);
      setTimeout(() => setWorkshopMsg(''), 12000);
    }
  };

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
    } catch (e: unknown) {
      setRerunMsg(e instanceof Error ? e.message : '重跑失败');
    } finally {
      setRerunning(null);
      setTimeout(() => setRerunMsg(''), 4000);
    }
  };

  return (
    <div className="cinema-card-hi p-5">
      {/* header + 下一步建议 */}
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="cinema-headline text-base flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-[var(--cinema-amber)]" />导演台 · 全链路控片
          </h3>
          <p className="cinema-subhead text-xs opacity-65 mt-0.5">逐环节查看状态 · 进入任意节点编辑 / 重生 · 了解重跑的下游影响</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {cnt('final_video') > 0 && projectId && (
            <button
              onClick={doWorkshop}
              disabled={workshopBusy}
              className="cinema-chip cinema-chip-amber hover:brightness-110 disabled:opacity-50 cursor-pointer"
              title="一键后期:Hook 弹药 → A/B 变体 + 双卡 → 发布文案 → 发布包"
            >
              🎁 {workshopBusy ? '包装中…' : '广告包装车间'}
            </button>
          )}
          <span className={`cinema-chip shrink-0 ${nextStage ? 'cinema-chip-amber' : 'cinema-chip-green'}`}>
            {nextStage ? <Lightning className="w-3 h-3" weight="fill" /> : <CheckCircle2 className="w-3 h-3" weight="fill" />}
            {nextHint}
          </span>
        </div>
      </div>

      {workshopMsg && (
        <div className="mb-3 text-xs cinema-subhead px-3 py-2 rounded-lg bg-white/5 border border-white/10">{workshopMsg}</div>
      )}

      {/* KPI 概览 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[3px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] px-3 py-2.5">
            <div className="cinema-eyebrow !text-[8px] opacity-50">{k.label}</div>
            <div className="cinema-mono text-xl text-[var(--cinema-amber)] tabular-nums leading-tight mt-0.5">{k.value}</div>
            <div className="cinema-mono text-[9px] opacity-45">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 进度 */}
      <div className={`cinema-meter ${rerunMsg ? 'mb-2' : 'mb-5'}`}>
        <div className="cinema-meter-fill" style={{ width: `${prog.pct}%` }} />
      </div>
      {rerunMsg && <p className="cinema-mono text-[11px] text-[var(--cinema-amber)] mb-4">{rerunMsg}</p>}

      {/* 环节流水线 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stages.map((s, i) => {
          const Icon = STAGE_ICON[s.id];
          const meta = STATUS_META[s.status];
          const down = downstreamStages(s.id);
          return (
            <div key={s.id} className="relative cinema-card p-4 flex flex-col">
              {/* 连接箭头 (大屏) */}
              {i < stages.length - 1 && (
                <ChevronRight className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--cinema-text-3)] z-10" />
              )}
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-[3px] grid place-items-center ${s.status === 'empty' ? 'bg-[var(--cinema-surface-2)] text-[var(--cinema-text-3)]' : 'bg-[var(--cinema-amber)]/15 text-[var(--cinema-amber)]'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="cinema-headline text-sm">{s.label}</div>
                  <div className="cinema-mono text-[10px] opacity-50">{s.desc}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className={`${meta.chip} !text-[10px]`}>{meta.label}</span>
                {s.count > 0 && <span className="cinema-mono text-[10px] opacity-50">{s.count} 项</span>}
              </div>

              {s.status === 'stale' && (
                <p className="cinema-mono text-[10px] text-[var(--cinema-amber)] opacity-90 flex items-start gap-1 mb-2">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />上游已更新,建议重生本环节
                </p>
              )}

              <div className="mt-auto flex gap-1.5">
                <button onClick={() => onEditStage(s.editTab)} className="cinema-btn-ghost !text-[11px] !py-1.5 flex-1">
                  <Pencil className="w-3 h-3" />{s.status === 'empty' ? '生成' : '编辑'}
                </button>
                {s.status !== 'empty' && (
                  <button
                    onClick={() => setImpact(impact === s.id ? null : s.id)}
                    title="重跑此环节"
                    className={`cinema-btn-ghost !text-[11px] !py-1.5 ${impact === s.id ? '!text-[var(--cinema-amber)] !border-[var(--cinema-amber-deep)]' : ''}`}
                  >
                    <RefreshCw className="w-3 h-3" />重跑
                  </button>
                )}
              </div>

              {impact === s.id && s.status !== 'empty' && (
                <div className="mt-2 rounded-[3px] bg-[var(--cinema-amber)]/[0.06] border border-[var(--cinema-amber-deep)] p-2">
                  <p className="cinema-mono text-[10px] text-[var(--cinema-amber)] opacity-90 leading-relaxed">
                    {down.length > 0
                      ? <>重跑「{s.label}」后,下游需重新生成:{down.map(stageLabel).join(' → ')}</>
                      : <>重跑「{s.label}」(末环节,无下游影响)</>}
                  </p>
                  {projectId && (
                    <button
                      onClick={() => doRerun(s.id)}
                      disabled={rerunning === s.id}
                      className="cinema-btn-primary !text-[10px] !py-1 mt-1.5 disabled:opacity-50"
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
