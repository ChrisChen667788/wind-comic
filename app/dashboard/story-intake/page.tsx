'use client';

/**
 * v6.2.1 — 长篇拆解工作台 UI.
 * 粘贴长篇小说/剧本 → 自动分集预览 + 叙事模式选择 → 逐集送入创作工坊 (orchestrator).
 * 拆分逻辑全在 lib/story-intake (已单测, client-safe); 这里只做交互 + 把某集 + 叙事指令
 * 经 sessionStorage 交给 /dashboard/create (避免长文本超 URL 长度).
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Scroll as ScrollText, Sparkle as Sparkles, CaretRight as ChevronRight, Stack as Layers, Microphone as Mic, SpeakerHigh as Volume2, ListChecks, ArrowCounterClockwise as RotateCcw, Waveform as AudioLines, CircleNotch as Loader2, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import {
  splitIntoEpisodes, NARRATION_MODES, getNarrationMode,
  type Episode, type NarrationMode,
} from '@/lib/story-intake';
import { buildNarrationTrack } from '@/lib/narration-track';
import {
  buildSeasonBatch, nextPending, markJob, batchProgress, type SeasonBatchPlan,
} from '@/lib/season-batch';

const BATCH_KEY = 'qfmj-season-batch';

export default function StoryIntakePage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<NarrationMode>('dialogue');
  const [targetChars, setTargetChars] = useState<string>('');
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  // v6.2.2: 整季批量 (持久化到 localStorage, 跨页面续跑)
  const [batch, setBatch] = useState<SeasonBatchPlan | null>(null);
  // v6.2.3: N 集并行解说音轨编排
  const [narrating, setNarrating] = useState(false);
  const [narrateReport, setNarrateReport] = useState<any | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BATCH_KEY);
      if (raw) setBatch(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persistBatch = (b: SeasonBatchPlan | null) => {
    setBatch(b);
    try {
      if (b) localStorage.setItem(BATCH_KEY, JSON.stringify(b));
      else localStorage.removeItem(BATCH_KEY);
    } catch { /* ignore */ }
  };

  const doSplit = () => {
    const tc = parseInt(targetChars, 10);
    const eps = splitIntoEpisodes(text, { targetChars: Number.isFinite(tc) && tc > 0 ? tc : undefined });
    setEpisodes(eps);
  };

  const seedAndGo = (seed: string) => {
    try { sessionStorage.setItem('qfmj-create-seed', seed); } catch { /* ignore */ }
    router.push('/dashboard/create');
  };

  const sendToCreate = (ep: Episode) => {
    const nm = getNarrationMode(mode);
    seedAndGo(`【叙事模式:${nm.label}】${nm.directive}\n\n${ep.title}\n${ep.text}`);
  };

  const startBatch = () => {
    if (!episodes || episodes.length === 0) return;
    persistBatch(buildSeasonBatch(episodes, { mode }));
  };

  // v6.2.3: 整季并行真出解说音轨 (后端 orchestrateSeason 有界并发)
  const narrateSeason = async () => {
    if (!episodes || episodes.length === 0) return;
    setNarrating(true); setNarrateReport(null);
    try {
      const res = await fetch('/api/season/narrate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes, mode, concurrency: 3 }),
      });
      const d = await res.json();
      setNarrateReport(res.ok ? d : { error: d?.message || '生成失败' });
    } catch (e: any) {
      setNarrateReport({ error: e?.message || '生成失败' });
    } finally {
      setNarrating(false);
    }
  };

  const sendNextBatch = () => {
    if (!batch) return;
    const job = nextPending(batch.jobs);
    if (!job) return;
    const updated = { ...batch, jobs: markJob(batch.jobs, job.episodeIndex, 'done') };
    persistBatch(updated);
    seedAndGo(job.seed);
  };

  const totalChars = text.trim().length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-amber-400" />
          长篇拆解
        </h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          粘贴长篇小说 / 剧本 → 自动分集 + 选叙事模式 → 逐集送入创作工坊
        </p>
      </div>

      {/* v6.2.2: 整季批量进度 (持久化, 跨页面续跑) */}
      {batch && batch.jobs.length > 0 && (() => {
        const prog = batchProgress(batch.jobs);
        const next = nextPending(batch.jobs);
        return (
          <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-white flex items-center gap-1.5"><ListChecks className="w-4 h-4 text-amber-400" />整季批量 · {batch.modeLabel}</p>
              <button onClick={() => persistBatch(null)} className="text-[11px] text-[var(--muted)] hover:text-white inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />重置</button>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2">
              <div className="h-full bg-amber-400 transition-all" style={{ width: `${prog.pct}%` }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[var(--muted)]">已送 {prog.done} / {prog.total} 集</span>
              {next ? (
                <button onClick={sendNextBatch} className="px-4 py-1.5 rounded-xl text-[12px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />送入下一集 (EP{next.episodeIndex} {next.title})<ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span className="text-[12px] text-emerald-400">✓ 全季已送入创作</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'粘贴整部小说或长剧本…\n\n· 有「第X章 / Chapter N / ## 标题」标记 → 按标记分集\n· 没有标记 → 按目标字数自动分集'}
        rows={10}
        className="w-full bg-black/40 border border-[var(--border)] rounded-2xl p-4 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-amber-500/40 transition-colors resize-y"
      />

      {/* Controls */}
      <div className="mt-3 flex flex-col gap-3">
        {/* 叙事模式 */}
        <div>
          <p className="text-xs text-[var(--muted)] mb-1.5 flex items-center gap-1"><Mic className="w-3 h-3" /> 叙事模式</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {NARRATION_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`text-left p-2.5 rounded-xl border transition-all ${
                  mode === m.id ? 'border-amber-500/50 bg-amber-500/10' : 'border-[var(--border)] bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <div className={`text-sm font-medium ${mode === m.id ? 'text-amber-300' : 'text-white'}`}>{m.label}</div>
                <div className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{m.description}</div>
                {m.generatesNarrationTrack && <div className="text-[10px] text-violet-300/80 mt-1">+ 解说音轨</div>}
              </button>
            ))}
          </div>
        </div>

        {/* target + 拆解 */}
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <p className="text-xs text-[var(--muted)] mb-1.5">单集目标字数(可选,无章节标记时生效)</p>
            <input
              type="number"
              value={targetChars}
              onChange={(e) => setTargetChars(e.target.value)}
              placeholder="默认 2000"
              className="w-40 bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-amber-500/40"
            />
          </div>
          <button
            onClick={doSplit}
            disabled={totalChars === 0}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            <Layers className="w-4 h-4" /> 智能拆解
          </button>
          {totalChars > 0 && <span className="text-[11px] text-[var(--muted)] pb-2">共 {totalChars} 字</span>}
        </div>
      </div>

      {/* Episodes */}
      {episodes && (
        <div className="mt-6">
          {episodes.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-10">未识别到可拆解的内容</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <p className="text-sm font-medium text-white">拆出 {episodes.length} 集 · 叙事:{getNarrationMode(mode).label}</p>
                <div className="flex items-center gap-2">
                  {getNarrationMode(mode).generatesNarrationTrack && (
                    <button
                      onClick={narrateSeason}
                      disabled={narrating}
                      className="px-3.5 py-1.5 rounded-xl text-[12px] font-medium bg-sky-500/15 text-sky-200 border border-sky-500/30 hover:bg-sky-500/25 transition-all inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {narrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AudioLines className="w-3.5 h-3.5" />}
                      整季并行解说音轨
                    </button>
                  )}
                  <button
                    onClick={startBatch}
                    className="px-3.5 py-1.5 rounded-xl text-[12px] font-medium bg-violet-500/15 text-violet-200 border border-violet-500/30 hover:bg-violet-500/25 transition-all inline-flex items-center gap-1.5"
                  >
                    <ListChecks className="w-3.5 h-3.5" />整季批量创作
                  </button>
                </div>
              </div>

              {/* v6.2.3: 整季并行解说音轨结果 */}
              {narrateReport && (
                <div className="mb-4 rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-4">
                  {narrateReport.error ? (
                    <p className="text-[12px] text-rose-300">⚠ {narrateReport.error}</p>
                  ) : (() => {
                    const r = narrateReport.report;
                    const anyRendered = r.results.some((x: any) => x.output?.rendered);
                    return (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-white flex items-center gap-1.5"><AudioLines className="w-4 h-4 text-sky-300" />解说音轨编排 · 并发 {narrateReport.concurrency}</p>
                          <span className="text-[11px] text-[var(--muted)]">成功 {r.ok}/{r.total} 集{r.failed ? ` · 失败 ${r.failed}` : ''}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {r.results.map((x: any) => (
                            <div key={x.episodeIndex} className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2">
                              <div className="flex items-center gap-1.5 text-[12px] text-white">
                                {x.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <RotateCcw className="w-3.5 h-3.5 text-rose-400" />}
                                <span className="text-sky-300">EP{x.episodeIndex}</span>
                                <span className="truncate">{x.title}</span>
                              </div>
                              {x.output && (
                                <p className="mt-1 text-[10px] text-[var(--muted)]">
                                  {x.output.segments} 句 · ~{x.output.durationSec}s · {x.output.voiceLabel}
                                  {x.output.rendered
                                    ? <span className="text-emerald-400"> · 已出音频 {x.output.okCount}</span>
                                    : <span className="text-amber-400"> · 计划就绪 (待配置 TTS)</span>}
                                </p>
                              )}
                              {x.error && <p className="mt-1 text-[10px] text-rose-300/90">{x.error}</p>}
                            </div>
                          ))}
                        </div>
                        {!anyRendered && (
                          <p className="mt-2 text-[10px] text-[var(--soft)]">
                            📌 解说音轨计划已并行编排完成;配置 <code className="text-amber-300">MINIMAX_API_KEY</code> 后将真出 mp3 音频。
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {episodes.map((ep) => (
                  <div key={ep.index} className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <h4 className="text-sm font-semibold text-white truncate">
                        <span className="text-amber-400 mr-1.5">EP{ep.index}</span>{ep.title}
                      </h4>
                      <span className="text-[10px] text-[var(--muted)] shrink-0">{ep.charCount} 字</span>
                    </div>
                    <p className="text-[12px] text-[var(--muted)] leading-relaxed line-clamp-3 flex-1">
                      {ep.text.slice(0, 160)}
                    </p>
                    {(() => {
                      const nt = buildNarrationTrack({ text: ep.text, mode });
                      return nt.enabled && nt.segments.length > 0 ? (
                        <p className="mt-2 text-[10px] text-violet-300/80 flex items-center gap-1">
                          <Volume2 className="w-3 h-3" />旁白 {nt.segments.length} 句 · ~{nt.totalDurationSec}s · {nt.voiceLabel}
                        </p>
                      ) : null;
                    })()}
                    <button
                      onClick={() => sendToCreate(ep)}
                      className="mt-3 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium bg-[#E8C547]/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> 用此集创作
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
