'use client';

/**
 * VoiceRetakePanel (v10.6.4) — 配音 retake 工作台(配音口型面板内,音色货架之下)。
 *
 * 逐对白镜:台词级情绪标签(EMOTION_LABELS)→ 单句重录(不动整集)→
 * A/B 版本对比试听(双 <audio preload> 预载,切换 <1s)→ 采用(该镜 video 置 stale)。
 * 勾选多句可批量重录(PIPELINE_QUEUE=1 时走重录队列)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Microphone, Play, Pause, CircleNotch, ArrowsClockwise, CheckCircle, CaretDown, CaretRight } from '@phosphor-icons/react';
import { EMOTION_LABELS } from '@/lib/tts-prosody';
import { getToken } from '@/lib/auth';

interface TakeRow { id: string; audioUrl: string | null; emotion: string; durationSec?: number; createdAt: string; adopted: boolean }
interface ShotState {
  shotNumber: number; text: string; speaker: string; scriptEmotion: string;
  activeUrl: string | null; activeEmotion: string | null; activeVersion: number | null;
  takes: TakeRow[];
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

export function VoiceRetakePanel({ projectId }: { projectId: string }) {
  const [shots, setShots] = useState<ShotState[]>([]);
  const [open, setOpen] = useState(false);
  const [emotionPick, setEmotionPick] = useState<Record<number, string>>({});
  const [busyShot, setBusyShot] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [abSide, setAbSide] = useState<'A' | 'B'>('B');
  const [pickedTake, setPickedTake] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const audioA = useRef<HTMLAudioElement | null>(null);
  // 逐 take 一个隐藏 <audio preload> 节点 —— 切 take 不改 src,预载不作废,A/B 才真 <1s
  const takeAudios = useRef<Record<string, HTMLAudioElement | null>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-retake`);
      if (res.ok) setShots((await res.json()).shots || []);
    } catch { /* 非关键路径 */ }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const retakeOne = async (s: ShotState) => {
    setBusyShot(s.shotNumber); setNotice('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-retake`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ shotNumber: s.shotNumber, emotion: emotionPick[s.shotNumber] || undefined }),
      });
      const b = await res.json();
      setNotice(b.ok ? `镜 ${s.shotNumber} 重录完成(${b.emotion})— 展开做 A/B 对比` : (b.error || '重录失败'));
      if (b.ok) { setExpanded(s.shotNumber); setPickedTake(b.takeId); setAbSide('B'); }
      await refresh();
    } catch { setNotice('重录失败'); }
    finally { setBusyShot(null); }
  };

  const retakeBatch = async () => {
    if (!checked.size) return;
    setBatchBusy(true); setNotice('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-retake`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ shots: Array.from(checked).map((n) => ({ shotNumber: n, emotion: emotionPick[n] || undefined })) }),
      });
      const b = await res.json();
      setNotice(b.queued ? `已入重录队列(${b.total} 句,任务 ${b.jobId})— 完成后刷新可见` : `批量完成:${b.done?.ok ?? 0}/${b.done?.total ?? checked.size} 句`);
      setChecked(new Set());
      await refresh();
    } catch { setNotice('批量重录失败'); }
    finally { setBatchBusy(false); }
  };

  const adopt = async (takeId: string) => {
    setNotice('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-retake`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ takeId }),
      });
      const b = await res.json();
      setNotice(b.ok ? `已采用 — 镜 ${b.shotNumber} 口型/成片已标待重渲(${b.staleMarked} 项)` : (b.error || '采用失败'));
      await refresh();
    } catch { setNotice('采用失败'); }
  };

  // A/B 切换:全部节点已 preload,只做 pause/play —— <1s
  const playSide = (side: 'A' | 'B', takeId?: string | null) => {
    setAbSide(side);
    const b = takeId ? takeAudios.current[takeId] : null;
    const on = side === 'A' ? audioA.current : b;
    audioA.current?.pause();
    for (const el of Object.values(takeAudios.current)) el?.pause();
    if (on) { on.currentTime = 0; on.play().catch(() => { /* 自动播放被拦 */ }); }
  };

  const stopAll = () => {
    audioA.current?.pause();
    for (const el of Object.values(takeAudios.current)) el?.pause();
  };

  if (!shots.length) return null;
  const takeCount = shots.reduce((n, s) => n + s.takes.length, 0);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 mb-3" data-testid="voice-retake">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 text-[11px] text-white/70">
        {open ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
        <Microphone className="w-3.5 h-3.5" /> 配音 retake · {shots.length} 句对白{takeCount ? `(${takeCount} 个重录版)` : ''}(单句换情绪重录 / A·B 对比 / 不动整集)
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {notice && <div className="px-2.5 py-1.5 rounded-md bg-[#E8C547]/10 border border-[#E8C547]/30 text-[11px] text-[#E8C547]" role="status">{notice}</div>}

          {shots.map((s) => {
            const isExpanded = expanded === s.shotNumber;
            const take = s.takes.find((t) => t.id === pickedTake) || s.takes[0] || null;
            return (
              <div key={s.shotNumber} className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="checkbox" checked={checked.has(s.shotNumber)}
                    onChange={(e) => setChecked((prev) => { const n = new Set(prev); e.target.checked ? n.add(s.shotNumber) : n.delete(s.shotNumber); return n; })}
                    aria-label={`选中镜 ${s.shotNumber}`} className="accent-[#E8C547]"
                  />
                  <span className="text-[10px] text-white/50 w-9 shrink-0">镜 {s.shotNumber}</span>
                  <span className="text-[11px] text-white/75 flex-1 min-w-0 truncate" title={s.text}>{s.speaker ? `${s.speaker}:` : ''}{s.text}</span>
                  <select
                    value={emotionPick[s.shotNumber] ?? (s.activeEmotion || s.scriptEmotion || '中性')}
                    onChange={(e) => setEmotionPick((m) => ({ ...m, [s.shotNumber]: e.target.value }))}
                    aria-label={`镜 ${s.shotNumber} 情绪标签`}
                    className="bg-white/[0.04] border border-white/10 rounded px-1 py-0.5 text-[10px] text-white/80 outline-none shrink-0"
                  >
                    {EMOTION_LABELS.map((l) => (<option key={l} value={l} className="bg-[#1a1a24]">{l}</option>))}
                  </select>
                  <button onClick={() => retakeOne(s)} disabled={busyShot != null} title="按所选情绪单句重录"
                    className="cinema-btn !px-1.5 !py-0.5 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50 shrink-0">
                    {busyShot === s.shotNumber ? <CircleNotch className="w-3 h-3 animate-spin" /> : <ArrowsClockwise className="w-3 h-3" />}重录
                  </button>
                  <button onClick={() => { stopAll(); setAbSide('B'); setExpanded(isExpanded ? null : s.shotNumber); setPickedTake(null); }}
                    className="text-[10px] text-white/45 hover:text-white shrink-0">
                    {s.takes.length} 版{isExpanded ? ' ▲' : ' ▼'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-2 pl-6 space-y-1.5">
                    {/* A/B 对比:当前版 vs 选中 take(双 audio 预载,切换即播) */}
                    <div className="flex items-center gap-2 text-[10.5px]">
                      <span className="text-white/45">A/B 试听:</span>
                      <button onClick={() => playSide('A')} disabled={!s.activeUrl}
                        className={`px-2 py-0.5 rounded border text-[10px] inline-flex items-center gap-1 disabled:opacity-40 ${abSide === 'A' ? 'border-[#E8C547]/60 text-[#E8C547]' : 'border-white/15 text-white/60'}`}>
                        {abSide === 'A' ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}A · 当前版{s.activeEmotion ? `(${s.activeEmotion})` : ''}
                      </button>
                      <button onClick={() => playSide('B', take?.id)} disabled={!take?.audioUrl}
                        className={`px-2 py-0.5 rounded border text-[10px] inline-flex items-center gap-1 disabled:opacity-40 ${abSide === 'B' ? 'border-[#E8C547]/60 text-[#E8C547]' : 'border-white/15 text-white/60'}`}>
                        {abSide === 'B' ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}B · 重录版{take ? `(${take.emotion})` : ''}
                      </button>
                      {s.activeUrl && <audio ref={audioA} src={s.activeUrl} preload="auto" />}
                      {s.takes.map((t) => t.audioUrl && (
                        <audio key={t.id} ref={(el) => { takeAudios.current[t.id] = el; }} src={t.audioUrl} preload="auto" />
                      ))}
                      {!s.activeUrl && <span className="text-white/35">(该镜还没有整集配音版,可直接采用重录版)</span>}
                    </div>

                    {s.takes.length === 0 ? (
                      <p className="text-[10px] text-white/35">还没有重录版 —— 选个情绪点「重录」试试。</p>
                    ) : s.takes.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-[10.5px] text-white/60">
                        <button onClick={() => { setPickedTake(t.id); playSide('B', t.id); }}
                          className={`px-1.5 py-0.5 rounded border text-[10px] ${pickedTake === t.id || (!pickedTake && t === s.takes[0]) ? 'border-[#E8C547]/50 text-[#E8C547]' : 'border-white/15'}`}>
                          {t.emotion}{t.durationSec ? ` · ${t.durationSec}s` : ''}
                        </button>
                        {t.adopted ? (
                          <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle className="w-3 h-3" />已采用</span>
                        ) : (
                          <button onClick={() => adopt(t.id)} className="text-white/50 hover:text-white border border-white/15 rounded px-1.5 py-0.5 text-[10px]">采用此版本</button>
                        )}
                        <span className="text-white/25 text-[9px]">{new Date(t.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={retakeBatch} disabled={batchBusy || checked.size === 0}
              className="cinema-btn cinema-btn-primary !px-2.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50">
              {batchBusy ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Microphone className="w-3 h-3" />}
              批量重录所选({checked.size} 句)
            </button>
            <span className="text-[10px] text-white/35">采用新配音后,该镜口型/成片会标待重渲 —— 其余镜零接触。</span>
          </div>
        </div>
      )}
    </div>
  );
}
