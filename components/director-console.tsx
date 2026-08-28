'use client';

/**
 * v6.4 — 导演台 (Director Console). v12.44 仪表盘化:顶部 KPI 概览(完成度/分镜/视频/成片)
 * + 下一步建议徽章 + cinema-meter 进度 + 创作主流程 4 环节(剧本→资产→分镜→成片)流水线
 * (状态/进编辑/重跑下游影响)。纯逻辑在 lib/pipeline-stages;全量 cinema 设计系统。
 */

import { useState } from 'react';

/** v12.356:导演评审结论(与 director-review 的 `review` 事件同形)。 */
/** 评审条目里的环节名 → 中文(与 review-node 的 STAGE_MAP 同一套叫法)。 */
const STAGE_LABEL: Record<string, string> = {
  writer: '编剧', character_designer: '角色', scene_designer: '场景',
  storyboard: '分镜', video_producer: '视频', editor: '剪辑',
};

interface DirectorReviewItem {
  stage?: string; severity?: string; issue?: string; suggestion?: string;
}
interface DirectorReview {
  /** v12.356:模型没给出结构化分数时为 null —— **不编一个** */
  overallScore: number | null;
  summary: string;
  /** 分数缺失时为 null:不敢说达标,也不敢说不达标 */
  passed: boolean | null;
  items: DirectorReviewItem[];
}
import {
  FileText, Users, FilmSlate as Clapperboard, FilmStrip as Film, Pencil,
  ArrowsClockwise as RefreshCw, Warning as AlertTriangle, CaretRight as ChevronRight,
  CheckCircle as CheckCircle2, CircleNotch as Loader2, Lightning,
} from '@phosphor-icons/react';
import {
  derivePipelineStages, downstreamStages, pipelineProgress,
  PIPELINE_STAGES, type StageAsset, type StageId, type StageStatus,
} from '@/lib/pipeline-stages';
import { healthTone } from '@/lib/quality-report';

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
  // v12.116:包装结果结构化面板(变体可点/健康分/文案标题),不再只有一行文本
  const [workshopResult, setWorkshopResult] = useState<{
    finalVideoUrl?: string | null;
    variants: Array<{ variant: number; hookTitle?: string; url: string | null; chosen?: boolean }>;
    title?: string;
    healthScore?: number | null;
  } | null>(null);

  // v12.44: 从 assets 按类型派生 KPI 概览
  const cnt = (t: string) => (assets as Array<{ type?: string }>).filter((a) => a?.type === t).length;
  const kpis: Array<{ label: string; value: string; sub: string; color?: string; tip?: string }> = [
    { label: 'PROGRESS', value: `${prog.pct}%`, sub: `${prog.produced}/${prog.total} 环节` },
    { label: 'SHOTS', value: String(cnt('storyboard')), sub: '分镜' },
    { label: 'CLIPS', value: String(cnt('video')), sub: '镜头视频' },
    { label: 'FILM', value: cnt('final_video') > 0 ? '✓' : '—', sub: '成片' },
  ];
  // v12.115:质检健康分 KPI(quality_report 资产存在时)—— 悬停看一句话摘要
  const qr = (assets as Array<{ type?: string; data?: { healthScore?: number; summary?: string } }>).find((a) => a?.type === 'quality_report');
  const health = typeof qr?.data?.healthScore === 'number' ? qr.data.healthScore : null;
  if (health !== null) {
    kpis.push({ label: 'HEALTH', value: String(health), sub: '质检健康分', color: healthTone(health).color, tip: qr?.data?.summary });
  }
  const nextStage = stages.find((s) => s.status === 'empty') || stages.find((s) => s.status === 'stale');
  const nextHint = nextStage
    ? (nextStage.status === 'empty' ? `下一步 · 生成「${nextStage.label}」` : `建议 · 重生「${nextStage.label}」`)
    : '全链路就绪 · 可导出成片';

  // v12.199:变体选胜 —— POST ab-variant/choose,成功后本地把 chosen 标记切到该变体并刷新主成片
  // v12.356:导演整体评审。端点 director-review 是 **SSE 流式**,而且从来没有前端调过 ——
  // `components/nodes/review-node` 能渲染评审结果,却**没有任何东西触发它**:
  // 有渲染器、没触发器。这里补的正是那个触发器。
  const [reviewing, setReviewing] = useState(false);
  const [reviewMsg, setReviewMsg] = useState('');
  const [reviewStream, setReviewStream] = useState('');
  const [review, setReview] = useState<DirectorReview | null>(null);
  const [reviewErr, setReviewErr] = useState('');

  const [choosingVariant, setChoosingVariant] = useState<number | null>(null);
  const chooseVariant = async (variant: number) => {
    if (!projectId || choosingVariant !== null) return;
    setChoosingVariant(variant);
    try {
      const res = await fetch(`/api/projects/${projectId}/ab-variant/choose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '选定失败');
      setWorkshopResult((prev) => prev ? {
        ...prev,
        finalVideoUrl: d.finalVideoUrl || prev.finalVideoUrl,
        variants: prev.variants.map((v) => ({ ...v, chosen: v.variant === variant })),
      } : prev);
      setWorkshopMsg(`✓ 变体${variant} 已设为正式成片`);
      onReran?.();
    } catch (e: unknown) {
      setWorkshopMsg(e instanceof Error ? e.message : '选定失败');
    } finally {
      setChoosingVariant(null);
    }
  };

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
      setWorkshopResult({
        finalVideoUrl: st.recompose?.finalVideoUrl || null,
        variants: Array.isArray(st.package?.abVariants) ? st.package.abVariants : [],
        title: st.publishCopy?.copy?.titles?.[0] || '',
        healthScore: st.package?.qualityHealthScore ?? null,
      });
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

  async function runDirectorReview() {
    setReviewing(true); setReviewErr(''); setReview(null); setReviewStream(''); setReviewMsg('');
    try {
      const res = await fetch(`/api/projects/${projectId}/director-review`, { method: 'POST' });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setReviewErr(j?.message || `评审失败(HTTP ${res.status})`);
        return;
      }
      // SSE:边收边显示,不让用户对着转圈等一分钟
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let acc = '';
      let gotReview = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: { type?: string; data?: Record<string, unknown> };
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          const d = ev.data || {};
          if (ev.type === 'status') setReviewMsg(String(d.message || ''));
          else if (ev.type === 'content') { acc += String(d.content || ''); setReviewStream(acc.slice(-600)); }
          else if (ev.type === 'error') setReviewErr(String(d.message || '评审失败'));
          else if (ev.type === 'review') {
            gotReview = true;
            setReview({
              // null 要原样保留 —— `Number(null) || 0` 会把「没评分」变成「0 分」
              overallScore: typeof d.overallScore === 'number' ? d.overallScore : null,
              summary: String(d.summary || ''),
              passed: typeof d.passed === 'boolean' ? d.passed : null,
              items: Array.isArray(d.items) ? (d.items as DirectorReviewItem[]) : [],
            });
          }
        }
      }
      // 流正常结束却没拿到结论 —— 如实说,别留个空面板让人以为在加载
      if (!gotReview) setReviewErr((e) => e || '评审流已结束但没有返回结论,请重试');
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : '评审失败');
    } finally {
      setReviewing(false);
      setReviewMsg('');
    }
  }

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
          {/* v12.356:让导演审一遍。有渲染器(review-node)没触发器 —— 这就是那个触发器。 */}
          {projectId && (
            <button
              onClick={runDirectorReview}
              disabled={reviewing}
              data-testid="director-review-run"
              className="cinema-chip hover:brightness-110 disabled:opacity-50 cursor-pointer"
              title="让导演 Agent 通读全片资产,给整体评分与逐项问题"
            >
              🎬 {reviewing ? '审片中…' : '让导演审一遍'}
            </button>
          )}
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

      {/* v12.356:导演评审 —— 流式过程 + 结论 */}
      {reviewErr && (
        <div role="alert" className="mb-3 text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300">
          {reviewErr}
        </div>
      )}
      {reviewing && (
        <div role="status" className="mb-3 text-xs cinema-subhead px-3 py-2 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            {reviewMsg || '导演正在审片…'}
          </div>
          {/* 边收边显示 —— 一分钟的等待里给点真东西看,而不是干转圈 */}
          {reviewStream && (
            <pre className="mt-2 text-[10px] opacity-55 whitespace-pre-wrap break-words max-h-24 overflow-hidden leading-relaxed">
              {reviewStream}
            </pre>
          )}
        </div>
      )}
      {review && !reviewing && (
        <div data-testid="director-review-result" className="mb-4 rounded-[3px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* v12.356:三态 —— 达标 / 未达标 / **模型没给出评分**。
                第三态不能画成绿牌,那正是原实现的假绿。 */}
            <span className={`cinema-chip ${
              review.passed === null ? '' : review.passed ? 'cinema-chip-green' : 'cinema-chip-amber'
            }`}>
              {review.passed === null
                ? <AlertTriangle className="w-3 h-3" />
                : review.passed
                  ? <CheckCircle2 className="w-3 h-3" weight="fill" />
                  : <AlertTriangle className="w-3 h-3" weight="fill" />}
              {review.overallScore === null ? '未给出评分' : `导演评分 ${review.overallScore}`}
            </span>
            <span className="cinema-subhead text-[11px] opacity-70">
              {review.passed === null ? '模型未返回结构化评分,只有下方文字意见' : review.passed ? '达标' : '未达标(< 75)'}
              {' · '}{review.items.length} 条待改
            </span>
          </div>
          {review.summary && (
            <p className="cinema-subhead text-[11px] opacity-80 leading-relaxed whitespace-pre-wrap">{review.summary}</p>
          )}
          {review.items.length > 0 && (
            <ul className="space-y-1.5">
              {review.items.map((it, i) => (
                <li key={i} className="text-[11px] leading-relaxed flex items-start gap-2">
                  <span className={`shrink-0 cinema-chip !text-[9px] !px-1.5 !py-0 ${
                    it.severity === 'high' || it.severity === '严重' ? 'cinema-chip-amber' : ''
                  }`}>
                    {STAGE_LABEL[it.stage || ''] || it.stage || '整体'}
                  </span>
                  <span className="flex-1">
                    <span className="opacity-85">{it.issue}</span>
                    {it.suggestion && <span className="opacity-60"> → {it.suggestion}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* 评审只是判断,不是事实 —— 说清楚它的定位 */}
          <p className="cinema-subhead text-[10px] opacity-45">
            这是 LLM 对全片资产的整体判断,供参考;客观测量见监看台的示波器与画风漂移。
          </p>
        </div>
      )}

      {workshopMsg && (
        <div className="mb-3 text-xs cinema-subhead px-3 py-2 rounded-lg bg-white/5 border border-white/10">{workshopMsg}</div>
      )}

      {/* v12.116:包装结果面板 —— 成片/变体直接可点,健康分着色,首选标题预览 */}
      {workshopResult && (
        <div className="mb-4 rounded-[3px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {workshopResult.finalVideoUrl && (
              <a href={workshopResult.finalVideoUrl} target="_blank" rel="noreferrer" className="cinema-chip cinema-chip-green hover:brightness-110">▶ 主成片</a>
            )}
            {workshopResult.variants.filter((v) => v.url).map((v) => (
              <span key={v.variant} className="inline-flex items-center gap-0.5">
                <a href={v.url as string} target="_blank" rel="noreferrer"
                   className={`cinema-chip hover:brightness-110 ${v.chosen ? 'cinema-chip-amber' : ''}`}
                   title={v.hookTitle || ''}>
                  {v.chosen ? '★' : '▶'} 变体{v.variant}{v.hookTitle ? ` · ${v.hookTitle.slice(0, 10)}` : ''}
                </a>
                {/* v12.199:选为正片 —— ab-variant/choose API 此前无前端入口 */}
                {!v.chosen && (
                  <button
                    onClick={() => chooseVariant(v.variant)}
                    disabled={choosingVariant !== null}
                    className="cinema-chip text-[10px] opacity-70 hover:opacity-100 disabled:opacity-30"
                    title="把该变体设为正式成片"
                  >
                    {choosingVariant === v.variant ? '…' : '选为正片'}
                  </button>
                )}
              </span>
            ))}
            {typeof workshopResult.healthScore === 'number' && (
              <span className="cinema-mono text-[11px] tabular-nums" style={{ color: healthTone(workshopResult.healthScore).color }}>
                HEALTH {workshopResult.healthScore}
              </span>
            )}
          </div>
          {workshopResult.title && (
            <p className="cinema-mono text-[11px] opacity-70">首选标题:{workshopResult.title}</p>
          )}
        </div>
      )}

      {/* KPI 概览 */}
      <div className={`grid grid-cols-2 ${kpis.length >= 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-2 mb-4`}>
        {kpis.map((k) => (
          <div key={k.label} title={k.tip} className="rounded-[3px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] px-3 py-2.5">
            <div className="cinema-eyebrow !text-[8px] opacity-50">{k.label}</div>
            <div className="cinema-mono text-xl tabular-nums leading-tight mt-0.5" style={{ color: k.color || 'var(--cinema-amber)' }}>{k.value}</div>
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
