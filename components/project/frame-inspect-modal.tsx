'use client';

/**
 * 逐帧检视弹窗 — v12.330。
 *
 * ── 为什么这一版是「接线」而不是新功能 ────────────────────────────
 * v12.315 建了片段重拍(API + take 历史),v12.328 建了逐帧检视(API),**两个都只有
 * 后端**。而这一轮我反复在说「造好没接线是本仓最顽固的病」—— 自己连着交付两个
 * 没界面的能力,就是在犯同一个毛病。这一版把它俩接起来,并且是**接成一件事**:
 *
 *   翻帧 → 框出坏的那一段 → 一键交给重拍(区间由后端 `retakeHint` 给,不由前端算)
 *
 * ── 一个刻意的克制:前端不算时间 ──────────────────────────────────
 * 帧号 → 秒的换算**全部走后端**(`frameRangeToSeconds`,与 `planSegmentRetake` 共用
 * 同一个 `snapToFrame`)。前端若自己 `i / fps`,就成了第三套帧吸附口径 —— 用户点了
 * 第 47 帧、后端却从 46 帧半切下去,而这种错**看不出来**,只体现为成片抖一下。
 * 所以这里只传**帧号**,秒数一律由服务端回。
 */

import { useCallback, useEffect, useState } from 'react';

interface FrameItem {
  frameIndex: number;
  atSec: number;
  url: string;
}

interface StripResponse {
  shotNumber: number;
  durationS: number;
  fps: number;
  thinned: boolean;
  step: number;
  frames: FrameItem[];
  failedFrames: number[];
  retakeHint: { fromS: number; toS: number } | null;
}

export interface FrameInspectModalProps {
  projectId: string;
  shotNumber: number;
  shotTitle?: string;
  onClose: () => void;
  /** 用户确认要重拍时回调 —— 区间来自服务端,不由本组件计算 */
  onRetake?: (range: { fromS: number; toS: number; fromFrame: number; toFrame: number }) => void;
}

export function FrameInspectModal({
  projectId, shotNumber, shotTitle, onClose, onRetake,
}: FrameInspectModalProps) {
  const [data, setData] = useState<StripResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** 选区的两端(帧号);只点一下 = 单帧 */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [range, setRange] = useState<{ fromS: number; toS: number } | null>(null);
  const [ranging, setRanging] = useState(false);

  const load = useCallback(async (from?: number, to?: number) => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ shot: String(shotNumber) });
      if (from != null) qs.set('from', String(from));
      if (to != null) qs.set('to', String(to));
      const r = await fetch(`/api/projects/${projectId}/frame-strip?${qs}`);
      const j = await r.json();
      if (!r.ok) { setError(j?.error || `加载失败(HTTP ${r.status})`); setData(null); return; }
      setData(j as StripResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, shotNumber]);

  useEffect(() => { void load(); }, [load]);

  const lo = anchor != null && focus != null ? Math.min(anchor, focus) : anchor;
  const hi = anchor != null && focus != null ? Math.max(anchor, focus) : anchor;

  /** 选好帧后向服务端要秒区间 —— 前端不做换算(见文件头) */
  const resolveRange = useCallback(async () => {
    if (lo == null || hi == null || !data) return;
    setRanging(true);
    try {
      const qs = new URLSearchParams({
        shot: String(shotNumber),
        from: String(lo / data.fps),
        to: String((hi + 1) / data.fps),
        max: '2',
      });
      const r = await fetch(`/api/projects/${projectId}/frame-strip?${qs}`);
      const j = await r.json();
      if (r.ok && j?.retakeHint) setRange(j.retakeHint);
      else setError(j?.error || '无法换算重拍区间');
    } finally {
      setRanging(false);
    }
  }, [lo, hi, data, projectId, shotNumber]);

  useEffect(() => { setRange(null); }, [anchor, focus]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-white/10 bg-neutral-950 text-neutral-100">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h2 className="text-base font-medium">
              逐帧检视 · 镜 {shotNumber}
              {shotTitle ? <span className="ml-2 text-sm text-neutral-400">{shotTitle}</span> : null}
            </h2>
            {data && (
              <p className="mt-1 text-xs text-neutral-400">
                {data.durationS.toFixed(3)}s · {data.fps}fps
                {/* 抽稀必须明说,否则用户以为看到的是每一帧 */}
                {data.thinned && <span className="ml-2 text-amber-400">已抽稀:每 {data.step} 帧取 1(帧数过多)</span>}
                {data.failedFrames.length > 0 && (
                  <span className="ml-2 text-amber-400">{data.failedFrames.length} 帧解码失败,已跳过</span>
                )}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-white/10" aria-label="关闭">✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading && <p className="text-sm text-neutral-400">正在抽帧…</p>}
          {error && (
            <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
          {data && data.frames.length === 0 && !loading && !error && (
            <p className="text-sm text-neutral-400">这一段没有可显示的帧。</p>
          )}
          {data && data.frames.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
              {data.frames.map((f) => {
                const selected = lo != null && hi != null && f.frameIndex >= lo && f.frameIndex <= hi;
                return (
                  <button
                    key={f.frameIndex}
                    onClick={() => {
                      if (anchor == null || (anchor != null && focus != null)) { setAnchor(f.frameIndex); setFocus(null); }
                      else setFocus(f.frameIndex);
                    }}
                    className={`overflow-hidden rounded border text-left transition ${
                      selected ? 'border-amber-400 ring-1 ring-amber-400' : 'border-white/10 hover:border-white/30'
                    }`}
                    aria-pressed={selected}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={`第 ${f.frameIndex} 帧`} className="block w-full" loading="lazy" />
                    <span className="block px-1.5 py-1 font-mono text-[11px] text-neutral-400">
                      #{f.frameIndex} · {f.atSec.toFixed(3)}s
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-3">
          <span className="text-xs text-neutral-400">
            {lo == null ? '点一帧开始选,再点一帧框出区间' : `已选 #${lo}${hi !== lo ? `–#${hi}` : ''}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {lo != null && (
              <button onClick={() => { setAnchor(null); setFocus(null); }}
                className="rounded border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5">清除选区</button>
            )}
            {lo != null && !range && (
              <button onClick={() => void resolveRange()} disabled={ranging}
                className="rounded border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50">
                {ranging ? '换算中…' : '换算重拍区间'}
              </button>
            )}
            {range && (
              <>
                <span className="font-mono text-xs text-amber-300">
                  {range.fromS.toFixed(3)}s → {range.toS.toFixed(3)}s
                </span>
                <button
                  onClick={() => onRetake?.({ ...range, fromFrame: lo!, toFrame: hi! })}
                  className="rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-amber-300"
                >
                  用这段做片段重拍
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
