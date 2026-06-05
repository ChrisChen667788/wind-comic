'use client';

/**
 * v9.6.2 — 配音口型面板(阶段十六 T1)。拉 /api/projects/[id]/lipsync(lib/lipsync-plan 聚合),
 * 展示:整片口型就绪度(pass/warn/block)+ 每句可对齐度 + 问题提示,并把所选对白句的 viseme
 * 关键帧轨可视化成「张口包络 sparkline」+ 一张**按关键帧实时动画的嘴**(▶ 播放驱动 jaw-open)。
 * 挂在「成片质检」tab(与一致性报告同列成片质量信号)。无对白 → 自动隐藏。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Microphone, Play, Stop } from '@phosphor-icons/react';

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

export function LipSyncPanel({ projectId }: { projectId: string }) {
  const [plan, setPlan] = useState<LipSyncPlan | null>(null);
  const [selShot, setSelShot] = useState<number | null>(null);
  const [open, setOpen] = useState(0);      // 当前张口量(动画驱动)
  const [playing, setPlaying] = useState(false);
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

  if (!plan || plan.lines === 0) return null;
  const lv = LEVEL_STYLE[plan.level];
  // 嘴:闭合 ry≈1.5,全开 ry≈12
  const mouthRy = 1.5 + open * 10.5;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
          <Microphone className="w-4 h-4" /> 配音口型 · {plan.lines} 句对白
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${lv.cls}`}>
          {lv.label} · 就绪度 {plan.readiness}
        </span>
      </div>

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
              </div>
              <div className="text-xs text-white/75 truncate mb-1.5">「{selected.text}」</div>
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
