'use client';

/**
 * components/project/monitor-tab (v8.0) — 技术监看台 (对标 CineFlow 底部监视器 + EDL/AAF 导出)
 *
 *   - 视频示波器:选一帧分镜 → 直方图 / 亮度波形 / RGB Parade (canvas 实采像素, lib/scopes 计算)
 *   - 专业出片:导出 EDL (CMX3600) / FCP7 XML 对接 DaVinci Resolve / Premiere Pro
 *
 * 注: 示波器需同源素材像素; 跨域外链图无法读 ImageData 时给出提示。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pulse as Activity, FileArrowDown as FileDown, Gauge, WarningCircle as AlertCircle, FilmStrip, ArrowsClockwise, CheckCircle, CircleNotch, Clock } from '@phosphor-icons/react';
import { computeHistogram, computeColumns, scopeStats, type ScopeStats } from '@/lib/scopes';
import { formatEta, type ShotRenderState, type RenderLoopSummary } from '@/lib/render-loop';

function firstMedia(sb: any): string | undefined {
  return sb?.persistentUrl || sb?.mediaUrls?.[0] || sb?.media_urls?.[0] || sb?.persistent_url;
}

export function MonitorTab({ projectId, storyboards = [] }: { projectId: string; storyboards?: any[] }) {
  const withImg = storyboards.filter((s) => firstMedia(s));
  const [sel, setSel] = useState<string | undefined>(() => firstMedia(withImg[0]));
  const [stats, setStats] = useState<ScopeStats | null>(null);
  const [err, setErr] = useState('');

  const histRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const paradeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const w = 160, h = Math.max(1, Math.round((160 * img.height) / (img.width || 160)));
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) throw new Error('no ctx');
        octx.drawImage(img, 0, 0, w, h);
        const data = octx.getImageData(0, 0, w, h).data;
        const hist = computeHistogram(data);
        setStats(scopeStats(hist));
        drawHistogram(histRef.current, hist);
        drawWaveform(waveRef.current, computeColumns(data, w, h, 128, 'luma'));
        drawParade(paradeRef.current, data, w, h);
        setErr('');
      } catch {
        setErr('该素材为跨域外链, 浏览器禁止读取像素 — 示波器需同源/已落盘素材');
        setStats(null);
      }
    };
    img.onerror = () => { if (!cancelled) { setErr('图片加载失败'); setStats(null); } };
    img.src = sel;
    return () => { cancelled = true; };
  }, [sel]);

  function download(format: 'edl' | 'fcpxml' | 'aaf') {
    const a = document.createElement('a');
    a.href = format === 'aaf'
      ? `/api/projects/${projectId}/export-aaf`
      : `/api/projects/${projectId}/export-edl?format=${format}`;
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* v9.2.1 渲染循环 — 每镜进度 / 重试 / 耗时 + 整体 ETA 实时反馈 */}
      <RenderLoopPanel projectId={projectId} />

      {/* 出片对接 */}
      <div className="cinema-card !p-4">
        <div className="cinema-eyebrow mb-2 flex items-center gap-1.5"><FileDown size={13} className="text-[var(--monitor-blue)]" /> 专业出片对接 · DaVinci / Premiere / Avid</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => download('edl')} className="cinema-btn-ghost !text-[11px]"><FileDown size={13} /> 导出 EDL (CMX3600)</button>
          <button onClick={() => download('fcpxml')} className="cinema-btn-ghost !text-[11px]"><FileDown size={13} /> 导出 FCP7 XML</button>
          <button onClick={() => download('aaf')} className="cinema-btn-ghost !text-[11px]"><FileDown size={13} /> 导出 AAF (Avid)</button>
          <span className="cinema-mono text-[10px] opacity-50 self-center">含镜头时长 + 素材路径, 按项目帧率生成时间码</span>
        </div>
      </div>

      {/* 示波器 */}
      <div className="cinema-card !p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="cinema-eyebrow flex items-center gap-1.5"><Activity size={13} className="text-[var(--scope-green)]" /> 视频示波器</span>
          {stats && (
            <span className="cinema-mono text-[10px] opacity-70 flex items-center gap-2">
              <Gauge size={11} /> 均亮 {stats.avgLuma} · 高光裁切 {(stats.clippedHighlights * 100).toFixed(1)}% · 暗部 {(stats.clippedShadows * 100).toFixed(1)}%
            </span>
          )}
        </div>

        {withImg.length === 0 && <div className="cinema-mono text-[11px] opacity-50">暂无分镜图可分析</div>}

        {withImg.length > 0 && (
          <>
            {/* 选帧 */}
            <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-2 mb-3">
              {withImg.map((sb, i) => {
                const u = firstMedia(sb);
                const active = u === sel;
                return (
                  <button key={sb.id || i} onClick={() => setSel(u)}
                    className={`shrink-0 rounded-md overflow-hidden border-2 transition ${active ? 'border-[var(--scope-green)]' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                    <img loading="lazy" decoding="async" src={u} alt="" className="w-16 h-10 object-cover" />
                  </button>
                );
              })}
            </div>

            {err && <div className="flex items-center gap-1.5 text-[var(--secondary)] text-xs mb-2"><AlertCircle size={13} />{err}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Scope label="直方图 HISTOGRAM"><canvas ref={histRef} width={256} height={90} className="w-full" style={{ imageRendering: 'pixelated' }} /></Scope>
              <Scope label="亮度波形 WAVEFORM"><canvas ref={waveRef} width={256} height={90} className="w-full" /></Scope>
              <Scope label="RGB PARADE"><canvas ref={paradeRef} width={256} height={90} className="w-full" /></Scope>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** v9.2.1 渲染循环 — 初始拉一次快照, 再开 SSE 实时回填; done 即停 (防 EventSource 重连风暴)。 */
function RenderLoopPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ summary: RenderLoopSummary; shots: ShotRenderState[] } | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    fetch(`/api/projects/${projectId}/render-loop?snapshot=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((snap) => { if (!closed && snap) setData(snap); })
      .catch(() => {});

    try {
      es = new EventSource(`/api/projects/${projectId}/render-loop`);
      setLive(true);
      const onSnap = (e: MessageEvent) => { try { setData(JSON.parse(e.data)); } catch { /* ignore */ } };
      es.addEventListener('progress', onSnap as EventListener);
      es.addEventListener('done', ((e: MessageEvent) => { onSnap(e); setLive(false); es?.close(); }) as EventListener);
      es.onerror = () => { setLive(false); es?.close(); };
    } catch { setLive(false); }

    return () => { closed = true; es?.close(); };
  }, [projectId]);

  if (!data || data.summary.total === 0) {
    return (
      <div className="cinema-card !p-4">
        <div className="cinema-eyebrow mb-1 flex items-center gap-1.5"><FilmStrip size={13} className="text-[var(--monitor-blue)]" /> 渲染循环 · RENDER LOOP</div>
        <div className="cinema-mono text-[11px] opacity-50">剧本 / 分镜尚未生成 — 开始创作后这里实时显示每镜渲染进度。</div>
      </div>
    );
  }

  const s = data.summary;
  return (
    <div className="cinema-card !p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="cinema-eyebrow flex items-center gap-1.5">
          <FilmStrip size={13} className="text-[var(--monitor-blue)]" /> 渲染循环 · RENDER LOOP
          {live && <span className="inline-flex items-center gap-1 text-[9px] text-[var(--monitor-blue)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--monitor-blue)] animate-pulse" /> LIVE</span>}
        </span>
        <span className="cinema-mono text-[10px] opacity-70 flex items-center gap-1.5">
          <Clock size={11} /> ETA {formatEta(s.etaMs)}{s.avgShotMs != null ? ` · 均 ${Math.round(s.avgShotMs / 1000)}s/镜` : ''}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
          <div className="h-full bg-[var(--monitor-blue)] transition-all duration-500" style={{ width: `${s.percent}%` }} />
        </div>
        <span className="cinema-mono text-[11px] tabular-nums">{s.done}/{s.total}</span>
        <span className="cinema-mono text-[11px] opacity-60 tabular-nums">{s.percent}%</span>
        {s.failed > 0 && <span className="cinema-mono text-[10px] text-[var(--secondary)]">{s.failed} 失败</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {data.shots.map((sh) => (
          <div key={sh.shotNumber} className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2 py-1.5">
            <ShotStatusIcon status={sh.status} />
            <span className="cinema-mono text-[10px] opacity-50 shrink-0">#{String(sh.shotNumber).padStart(2, '0')}</span>
            <span className="text-[11px] truncate flex-1" title={sh.name}>{sh.name}</span>
            <span className="cinema-mono text-[9px] opacity-50 shrink-0">{sh.stage === 'video' ? '视频' : '分镜'}</span>
            {sh.attempts > 1 && <span className="cinema-mono text-[9px] text-[var(--secondary)] flex items-center gap-0.5 shrink-0"><ArrowsClockwise size={9} />{sh.attempts}</span>}
            {sh.durationMs != null && <span className="cinema-mono text-[9px] opacity-40 shrink-0">{Math.round(sh.durationMs / 1000)}s</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShotStatusIcon({ status }: { status: ShotRenderState['status'] }) {
  if (status === 'done') return <CheckCircle size={14} weight="fill" className="text-[var(--scope-green)] shrink-0" />;
  if (status === 'failed') return <AlertCircle size={14} weight="fill" className="text-[var(--secondary)] shrink-0" />;
  if (status === 'active') return <CircleNotch size={14} className="text-[var(--monitor-blue)] shrink-0 animate-spin" />;
  return <span className="w-3.5 h-3.5 rounded-full border border-[var(--border)] shrink-0 inline-block" />;
}

function Scope({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="cinema-mono text-[9px] opacity-50 mb-1">{label}</div>
      <div className="rounded-md border border-[var(--border)] bg-black overflow-hidden">{children}</div>
    </div>
  );
}

// ── canvas 绘制 (纯客户端) ──
function drawHistogram(cv: HTMLCanvasElement | null, hist: { r: number[]; g: number[]; b: number[]; luma: number[] }) {
  if (!cv) return;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const { width: W, height: H } = cv;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const max = Math.max(1, ...hist.luma, ...hist.r, ...hist.g, ...hist.b);
  const series: [number[], string][] = [[hist.r, 'rgba(255,80,80,0.7)'], [hist.g, 'rgba(80,255,120,0.7)'], [hist.b, 'rgba(90,143,255,0.7)'], [hist.luma, 'rgba(232,197,71,0.85)']];
  ctx.globalCompositeOperation = 'lighter';
  for (const [arr, color] of series) {
    ctx.strokeStyle = color; ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * W;
      const y = H - (arr[i] / max) * (H - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawWaveform(cv: HTMLCanvasElement | null, cols: number[]) {
  if (!cv) return;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const { width: W, height: H } = cv;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(232,197,71,0.85)'; ctx.lineWidth = 1; ctx.beginPath();
  cols.forEach((v, i) => {
    const x = (i / Math.max(1, cols.length - 1)) * W;
    const y = H - (v / 255) * (H - 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawParade(cv: HTMLCanvasElement | null, data: ArrayLike<number>, w: number, h: number) {
  if (!cv) return;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const { width: W, height: H } = cv;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const third = Math.floor(W / 3);
  const chans: [('r' | 'g' | 'b'), string][] = [['r', 'rgba(255,80,80,0.85)'], ['g', 'rgba(80,255,120,0.85)'], ['b', 'rgba(90,143,255,0.85)']];
  chans.forEach(([ch, color], ci) => {
    const cols = computeColumns(data, w, h, third, ch);
    ctx.strokeStyle = color; ctx.beginPath();
    cols.forEach((v, i) => {
      const x = ci * third + (i / Math.max(1, cols.length - 1)) * (third - 2);
      const y = H - (v / 255) * (H - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}
