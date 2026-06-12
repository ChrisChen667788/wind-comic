'use client';

/**
 * v9.6.2 — 配音口型面板(阶段十六 T1)。拉 /api/projects/[id]/lipsync(lib/lipsync-plan 聚合),
 * 展示:整片口型就绪度(pass/warn/block)+ 每句可对齐度 + 问题提示,并把所选对白句的 viseme
 * 关键帧轨可视化成「张口包络 sparkline」+ 一张**按关键帧实时动画的嘴**(▶ 播放驱动 jaw-open)。
 * 挂在「成片质检」tab(与一致性报告同列成片质量信号)。无对白 → 自动隐藏。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Microphone, Play, Stop, ArrowsClockwise, FilmSlate, CircleNotch, SpeakerHigh, Waveform } from '@phosphor-icons/react';
import { lipSyncReshootHints } from '@/lib/lipsync-plan';
import { rmsEnvelope, scoreLipAudioAlignment, autoAlignVisemes, shiftVisemeTrack } from '@/lib/lipsync-align';
import { LipSyncBatchPanel } from './lipsync-batch-panel';
import { VoiceShelf } from './voice-shelf';
import { VoiceRetakePanel } from './voice-retake-panel';

type Viseme = 'sil' | 'MBP' | 'FV' | 'aa' | 'E' | 'I' | 'O' | 'U';
interface VisemeKeyframe { t: number; viseme: Viseme; mouthOpen: number; }
interface LineAlignment {
  shotNumber: number; score: number; speakerOnScreen: boolean; faceVisible: boolean;
  durationFits: boolean; alignable: boolean; issues: string[];
}
interface LinePlan {
  shotNumber: number; speaker?: string; text: string;
  windowSec: { start: number; end: number }; visemes: VisemeKeyframe[]; alignment: LineAlignment;
}
interface LipSyncPlan {
  lines: number; perLine: LinePlan[]; readiness: number;
  level: 'none' | 'pass' | 'warn' | 'block'; weakest: LinePlan | null; hints: string[];
}

const LEVEL_STYLE: Record<LipSyncPlan['level'], { cls: string; label: string }> = {
  pass: { cls: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10', label: '口型就绪' },
  warn: { cls: 'text-amber-400 border-amber-400/30 bg-amber-400/10', label: '部分对不上' },
  block: { cls: 'text-rose-400 border-rose-400/30 bg-rose-400/10', label: '多处对不上' },
  none: { cls: '', label: '' },
};
const scoreColor = (s: number) => (s >= 80 ? 'text-emerald-400' : s >= 60 ? 'text-amber-400' : 'text-rose-400');

/** 在 viseme 关键帧轨上按相对时间 t(秒)取当前张口量(阶梯保持)。 */
function mouthOpenAt(frames: VisemeKeyframe[], t: number): number {
  if (!frames.length) return 0;
  let v = frames[0].mouthOpen;
  for (const f of frames) { if (f.t <= t) v = f.mouthOpen; else break; }
  return v;
}

export function LipSyncPanel({ projectId, onJumpToWorkshop }: { projectId: string; onJumpToWorkshop?: (shotNumbers: number[]) => void }) {
  const [plan, setPlan] = useState<LipSyncPlan | null>(null);
  const [selShot, setSelShot] = useState<number | null>(null);
  const [open, setOpen] = useState(0);      // 当前张口量(动画驱动)
  const [playing, setPlaying] = useState(false);
  const [engine, setEngine] = useState<{ configured: boolean; hint?: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderMsg, setRenderMsg] = useState<{ ok: boolean; text: string; videoUrl?: string } | null>(null);
  const [synthingAudio, setSynthingAudio] = useState(false);
  const [audioMsg, setAudioMsg] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);
  const [alignResult, setAlignResult] = useState<{ shotNumber: number; score: number; verdict: string; lagSec: number; corrected?: VisemeKeyframe[]; before?: number; after?: number } | null>(null);
  const audioUrlsRef = useRef<Map<number, string>>(new Map());
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync`);
        const body = await res.json();
        if (alive && res.ok) {
          const p = body.plan as LipSyncPlan;
          setPlan(p);
          setSelShot(p.weakest?.shotNumber ?? p.perLine[0]?.shotNumber ?? null);
        }
      } catch { /* 静默:增强信息 */ }
      try {
        const er = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync/render`);
        const eb = await er.json();
        if (alive && er.ok) setEngine({ configured: !!eb.configured, hint: eb.hint });
      } catch { /* 静默 */ }
      try {
        const sr = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-audio`);
        const sb = await sr.json();
        if (alive && sr.ok && Array.isArray(sb.shots)) {
          const m = new Map<number, string>();
          for (const s of sb.shots) if (s.audioUrl) m.set(s.shotNumber, s.audioUrl);
          audioUrlsRef.current = m;
        }
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [projectId]);

  const selected = plan?.perLine.find((l) => l.shotNumber === selShot) || plan?.perLine[0] || null;

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
    setOpen(0);
  }, []);

  const play = useCallback(() => {
    if (!selected || selected.visemes.length === 0) return;
    const dur = Math.max(0.3, selected.windowSec.end - selected.windowSec.start);
    setPlaying(true);
    startRef.current = 0;
    const tick = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = (ts - startRef.current) / 1000;
      if (elapsed >= dur) { setOpen(0); setPlaying(false); rafRef.current = null; return; }
      setOpen(mouthOpenAt(selected.visemes, elapsed));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [selected]);

  const renderLipSync = useCallback(async (visemesOverride?: VisemeKeyframe[]) => {
    if (!selected) return;
    setRendering(true); setRenderMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotNumber: selected.shotNumber, visemes: visemesOverride && visemesOverride.length ? visemesOverride : selected.visemes }),
      });
      const b = await res.json();
      if (b.ok && b.videoUrl) setRenderMsg({ ok: true, text: `口型视频已生成(${b.provider})${b.writtenBack ? ' · 已写回分镜/时间线' : ''}`, videoUrl: b.videoUrl });
      else setRenderMsg({ ok: false, text: b.message || b.hint || '渲染失败' });
    } catch (e) {
      setRenderMsg({ ok: false, text: e instanceof Error ? e.message : '渲染失败' });
    } finally { setRendering(false); }
  }, [projectId, selected]);

  const synthAudio = useCallback(async () => {
    setSynthingAudio(true); setAudioMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-audio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const b = await res.json();
      if (b.ok) setAudioMsg(`已合成 ${b.synthesized}/${b.total} 句配音 —— 现在「真渲染口型」可自动取音`);
      else setAudioMsg(b.message || '配音合成失败');
    } catch (e) {
      setAudioMsg(e instanceof Error ? e.message : '配音合成失败');
    } finally { setSynthingAudio(false); }
  }, [projectId]);

  // 口型-音频对齐专项评分(v9.7.6):浏览器 Web Audio 解码该镜配音 → 能量包络 → 与张口包络算相关
  const measureAlign = useCallback(async () => {
    if (!selected) return;
    const url = audioUrlsRef.current.get(selected.shotNumber);
    if (!url) { setAlignResult(null); setAudioMsg('该镜尚无配音 —— 先「合成全片配音」再测对齐'); return; }
    setAligning(true);
    try {
      const AC: typeof AudioContext | undefined = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error('浏览器不支持 Web Audio');
      const ac = new AC();
      const arr = await fetch(url).then((r) => r.arrayBuffer());
      const audio = await ac.decodeAudioData(arr);
      const energy = rmsEnvelope(audio.getChannelData(0), 64);
      ac.close();
      const durationSec = audio.duration || (selected.windowSec.end - selected.windowSec.start);
      const flat = selected.visemes.map((f) => ({ t: f.t, mouthOpen: f.mouthOpen }));
      const r = scoreLipAudioAlignment({ visemes: flat, audioEnergy: energy, durationSec });
      // v9.7.11 漂移自动校正:测时延 → 平移补偿后的轨(保留 viseme 字段供重渲)
      const aa = autoAlignVisemes({ visemes: flat, audioEnergy: energy, durationSec });
      const corrected = Math.abs(aa.offsetSec) >= 0.05 ? shiftVisemeTrack(selected.visemes, aa.offsetSec) : undefined;
      setAlignResult({ shotNumber: selected.shotNumber, score: r.score, verdict: r.verdict, lagSec: r.lagSec, corrected, before: aa.before, after: aa.after });
      // v9.7.14:存实测对齐分 → publish-readiness 发布门禁据此并入「口型对齐」维度
      fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync-align`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scores: { [selected.shotNumber]: r.score } }),
      }).catch(() => {});
    } catch (e) {
      setAudioMsg(e instanceof Error ? e.message : '对齐测量失败');
    } finally { setAligning(false); }
  }, [selected]);

  if (!plan || plan.lines === 0) return null;
  const lv = LEVEL_STYLE[plan.level];
  const reshoot = lipSyncReshootHints(plan); // v9.6.4 融门禁:口型对不上 → 可执行重拍提示
  // 嘴:闭合 ry≈1.5,全开 ry≈12
  const mouthRy = 1.5 + open * 10.5;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
          <Microphone className="w-4 h-4" /> 配音口型 · {plan.lines} 句对白
        </div>
        <div className="flex items-center gap-2">
          {engine && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${engine.configured ? 'text-sky-300 border-sky-400/30 bg-sky-400/10' : 'text-white/35 border-white/10'}`} title={engine.hint || ''}>
              引擎{engine.configured ? '已配置' : '未配置'}
            </span>
          )}
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${lv.cls}`}>
            {lv.label} · 就绪度 {plan.readiness}
          </span>
        </div>
      </div>

      {/* 配音合成(给真渲染供音):合成全片对白 TTS → shot-audio 资产,render 自动取音 */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={synthAudio}
          disabled={synthingAudio}
          className="cinema-btn !px-2.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50"
        >
          {synthingAudio ? <CircleNotch className="w-3 h-3 animate-spin" /> : <SpeakerHigh className="w-3 h-3" />}
          {synthingAudio ? '合成中…' : '合成全片配音'}
        </button>
        {audioMsg && <span className="text-[10px] text-white/45 truncate">{audioMsg}</span>}
      </div>

      {/* 角色音色货架:手动挑 / 试听,覆盖自动路由 */}
      <VoiceShelf projectId={projectId} characters={plan.perLine.map((l) => l.speaker || '')} />
      {/* v10.6.4 — 配音 retake 工作台:单句换情绪重录 / A·B 对比 / 不动整集 */}
      <VoiceRetakePanel projectId={projectId} />

      {/* 一键全片口型:配音 → 逐镜渲染 → 写回(复用 oneclick 编排骨架) */}
      <LipSyncBatchPanel projectId={projectId} shotNumbers={plan.perLine.map((l) => l.shotNumber)} />

      {/* 选中句:动画嘴 + 张口包络 sparkline */}
      {selected && (
        <div className="rounded-lg bg-black/30 border border-white/5 p-3 mb-3">
          <div className="flex items-center gap-3">
            {/* 动画嘴 */}
            <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
              <rect x="6" y="6" width="44" height="44" rx="12" fill="#1a1a24" stroke="#ffffff15" />
              <circle cx="20" cy="24" r="2.5" fill="#ffffff80" />
              <circle cx="36" cy="24" r="2.5" fill="#ffffff80" />
              <ellipse cx="28" cy="38" rx="9" ry={mouthRy} fill="#E86A6A" stroke="#ffffff20" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-white/50">第 {selected.shotNumber} 镜</span>
                {selected.speaker && <span className="text-[11px] text-white/70">{selected.speaker}</span>}
                <button
                  onClick={playing ? stop : play}
                  className="ml-auto cinema-btn !px-2 !py-1 !text-[10px] inline-flex items-center gap-1"
                >
                  {playing ? <Stop className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {playing ? '停止' : '播放口型'}
                </button>
                <button
                  onClick={() => renderLipSync()}
                  disabled={rendering}
                  title={engine && !engine.configured ? (engine.hint || '') : '调用口型引擎真渲染这一镜'}
                  className="cinema-btn cinema-btn-primary !px-2 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {rendering ? <CircleNotch className="w-3 h-3 animate-spin" /> : <FilmSlate className="w-3 h-3" />}
                  {rendering ? '渲染中…' : '真渲染口型'}
                </button>
                <button
                  onClick={measureAlign}
                  disabled={aligning}
                  title="浏览器解码该镜配音 → 测「嘴开合 vs 声音能量」对齐度"
                  className="cinema-btn !px-2 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {aligning ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Waveform className="w-3 h-3" />}
                  {aligning ? '测量中…' : '测音画对齐'}
                </button>
              </div>
              <div className="text-xs text-white/75 truncate mb-1.5">「{selected.text}」</div>
              {alignResult && alignResult.shotNumber === selected.shotNumber && (
                <div className="text-[11px] mb-1.5 flex items-center gap-2">
                  <span className="text-white/45">音画对齐</span>
                  <span className={`font-medium ${scoreColor(alignResult.score)}`}>{alignResult.score}</span>
                  <span className="text-white/35">
                    {alignResult.verdict === 'good' ? '口型跟得上声音' : alignResult.verdict === 'fair' ? '基本同步' : '明显对不上'}
                    {Math.abs(alignResult.lagSec) >= 0.05 ? ` · 音频${alignResult.lagSec > 0 ? '滞后' : '超前'} ${Math.abs(alignResult.lagSec)}s` : ''}
                  </span>
                  {alignResult.corrected && alignResult.corrected.length > 0 && (
                    <button
                      onClick={() => renderLipSync(alignResult.corrected)}
                      disabled={rendering}
                      title={`检出漂移,平移补偿后重渲(裸对齐 ${alignResult.before}→${alignResult.after})`}
                      className="cinema-btn !px-1.5 !py-0.5 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <ArrowsClockwise className="w-2.5 h-2.5" /> 校正漂移重渲
                    </button>
                  )}
                </div>
              )}
              {/* 张口包络:每个关键帧一根柱 */}
              <div className="flex items-end gap-px h-6">
                {selected.visemes.map((f, i) => (
                  <div
                    key={i}
                    className="flex-1 min-w-[2px] rounded-sm bg-gradient-to-t from-rose-500/40 to-rose-300/80"
                    style={{ height: `${Math.max(6, f.mouthOpen * 100)}%` }}
                    title={`${f.viseme} · 张口 ${Math.round(f.mouthOpen * 100)}%`}
                  />
                ))}
              </div>
              {renderMsg && (
                <div className={`text-[11px] mt-1.5 ${renderMsg.ok ? 'text-emerald-400' : 'text-white/45'}`}>
                  {renderMsg.text}
                  {renderMsg.ok && renderMsg.videoUrl && (
                    <a href={renderMsg.videoUrl} target="_blank" rel="noreferrer" className="ml-1 underline text-emerald-300">查看视频</a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 每句可对齐度 */}
      <div className="space-y-1.5 mb-3">
        {plan.perLine.map((l) => (
          <button
            key={l.shotNumber}
            onClick={() => { stop(); setSelShot(l.shotNumber); }}
            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors ${
              l.shotNumber === selShot ? 'border-white/20 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.03]'
            }`}
          >
            <span className="text-[11px] text-white/40 w-10 shrink-0">#{l.shotNumber}</span>
            <span className="text-xs text-white/70 truncate flex-1 min-w-0">
              {l.speaker ? `${l.speaker}:` : ''}{l.text}
            </span>
            {l.alignment.issues[0] && (
              <span className="text-[10px] text-white/35 truncate max-w-[40%] hidden sm:inline">{l.alignment.issues[0]}</span>
            )}
            <span className={`text-[11px] font-medium shrink-0 ${scoreColor(l.alignment.score)}`}>{l.alignment.score}</span>
          </button>
        ))}
      </div>

      {/* 口型重拍建议(融门禁:对不上 → 可执行修法 + 一键去工坊) */}
      {reshoot.count > 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-2.5 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-amber-300/90 font-medium">口型重拍建议 · {reshoot.count}</span>
            {onJumpToWorkshop && (
              <button
                onClick={() => onJumpToWorkshop(reshoot.shots.map((s) => s.shotNumber))}
                className="cinema-btn !px-2 !py-0.5 !text-[10px] inline-flex items-center gap-1"
              >
                <ArrowsClockwise className="w-3 h-3" /> 一键去工坊重拍
              </button>
            )}
          </div>
          <div className="space-y-1">
            {reshoot.shots.map((s) => (
              <button
                key={s.shotNumber}
                onClick={() => { stop(); setSelShot(s.shotNumber); }}
                className="w-full text-left flex items-start gap-2 text-[11px] text-white/55 hover:text-white/80"
              >
                <span className="text-white/35 shrink-0">#{s.shotNumber}</span>
                <span className="text-amber-300/70 shrink-0">{s.reason}</span>
                <span className="min-w-0">{s.focusHint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 汇总提示 */}
      <div className="space-y-1">
        {plan.hints.map((h, i) => (
          <div key={i} className="text-[11px] text-white/45 flex gap-1.5">
            <span className="text-white/25">·</span>{h}
          </div>
        ))}
      </div>
    </div>
  );
}
