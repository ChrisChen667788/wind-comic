'use client';

/**
 * 阶段二十九 v12.35.0(九宫格 3/3)— 候选帧九宫格工作台 modal。
 *
 * 一镜先出 N(4/6/9)个**构图各异**候选 → SSE 逐格实时填网格 → 点选最优 →
 * 选中帧「上位」为该镜分镜图(后续视频生成首帧 seed)。把 AI 随机性从「碰运气」变「一眼挑」。
 *
 * 后端:POST /api/projects/[id]/candidates(SSE)+ /candidates/pick(JSON),均需登录(Bearer)。
 */

import { useState } from 'react';
import { X, CircleNotch as Loader2, SquaresFour as Grid, Check, ImageBroken as ImageOff, Sparkle as Sparkles } from '@phosphor-icons/react';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { getToken } from '@/lib/auth';
import { gridDimensions, type CandidateCount } from '@/lib/candidate-grid';

export interface CandidateGridModalProps {
  projectId: string;
  shotNumber: number;
  basePrompt: string;
  defaultAspectRatio?: string;
  onPick: (imageUrl: string) => void;
  onCancel: () => void;
}

interface Cell { id: string; index: number; variantLabel: string; imageUrl?: string; error?: string }

export function CandidateGridModal({ projectId, shotNumber, basePrompt, defaultAspectRatio, onPick, onCancel }: CandidateGridModalProps) {
  const [count, setCount] = useState<CandidateCount>(9);
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio || '16:9');
  const [cells, setCells] = useState<Cell[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useFocusTrap<HTMLDivElement>(true, () => { if (!busy && !picking) onCancel(); });

  const authHeaders = (): Record<string, string> => {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' };
  };

  const { cols } = gridDimensions(count);
  // v12.36.0(视觉 QA 修复):候选格宽高比跟随所选画幅,避免 9:16 竖屏候选被 16:9 格裁掉。
  const ASPECT_CLASS: Record<string, string> = { '16:9': 'aspect-video', '9:16': 'aspect-[9/16]', '1:1': 'aspect-square', '2.35:1': 'aspect-[2.35/1]' };
  const aspectClass = ASPECT_CLASS[aspectRatio] || 'aspect-video';
  // 竖屏候选格更高,3 列会顶到很长 → 竖屏时收成 2 列,网格更紧凑(body 仍可滚)。
  const effectiveCols = aspectRatio === '9:16' ? Math.min(cols, 2) : cols;

  const handleGenerate = async () => {
    if (busy) return;
    const trimmed = (basePrompt || '').trim();
    if (trimmed.length < 5) { setError('该镜基础 prompt 太短(<5 字),先在分镜里补全描述'); return; }
    setBusy(true); setError(null); setCells([]); setStatus(`生成 ${count} 个候选…`);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/candidates`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ shotNumber, basePrompt: trimmed, count, aspectRatio }),
      });
      if (!res.ok && !res.body) {
        const txt = await res.text().catch(() => '');
        setError(`请求失败 (${res.status}): ${txt.slice(0, 120)}`); return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setError('无法读取响应流'); return; }
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'status') setStatus(evt.data?.message || '处理中…');
            else if (evt.type === 'candidate' && evt.data?.candidate) {
              const c = evt.data.candidate as Cell;
              setCells((prev) => {
                const next = prev.filter((x) => x.id !== c.id);
                next.push(c); next.sort((a, b) => a.index - b.index); return next;
              });
            } else if (evt.type === 'complete') {
              setStatus(`完成:${(evt.data?.candidates?.length ?? 0)} 个候选,点一张采用`);
            } else if (evt.type === 'error') setError(evt.data?.message || '生成失败');
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally { setBusy(false); }
  };

  const handlePick = async (id: string) => {
    if (busy || picking) return;
    setPicking(id); setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/candidates/pick`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ shotNumber, pickedId: id }),
      });
      const body = await res.json();
      if (!res.ok || !body.imageUrl) { setError(body?.error || `采用失败 (${res.status})`); return; }
      onPick(body.imageUrl); // 父组件刷新该镜分镜图,然后关闭
    } catch (e) {
      setError(e instanceof Error ? e.message : '采用失败');
    } finally { setPicking(null); }
  };

  const ready = cells.filter((c) => c.imageUrl).length;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 outline-none"
      role="dialog" aria-modal="true" aria-label={`九宫格候选帧 · Shot ${shotNumber}`} tabIndex={-1}
    >
      <div className="w-full max-w-3xl max-h-[92vh] rounded-2xl bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] shadow-2xl flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-5 py-3 border-b border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Grid className="w-4 h-4 text-[var(--cinema-amber)]" />
            <h3 className="text-sm font-semibold text-[var(--cinema-text)]">九宫格候选帧 · Shot {shotNumber}</h3>
          </div>
          <button onClick={onCancel} disabled={busy || !!picking} className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>

        {/* controls */}
        <div className="px-5 py-3 border-b border-[var(--cinema-border)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="cinema-mono text-[11px] opacity-60">候选数:</span>
            {([4, 6, 9] as const).map((c) => (
              <button key={c} onClick={() => setCount(c)} disabled={busy}
                className={`cinema-mono text-[10px] px-2 py-0.5 rounded border ${count === c ? 'bg-[var(--cinema-amber)]/20 border-[var(--cinema-amber)] text-[var(--cinema-amber)]' : 'border-[var(--cinema-border)] opacity-60 hover:opacity-100'} disabled:opacity-30`}>{c}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="cinema-mono text-[11px] opacity-60">画幅:</span>
            {(['16:9', '9:16', '1:1', '2.35:1'] as const).map((a) => (
              <button key={a} onClick={() => setAspectRatio(a)} disabled={busy}
                className={`cinema-mono text-[10px] px-2 py-0.5 rounded border ${aspectRatio === a ? 'bg-[var(--cinema-amber)]/20 border-[var(--cinema-amber)] text-[var(--cinema-amber)]' : 'border-[var(--cinema-border)] opacity-60 hover:opacity-100'} disabled:opacity-30`}>{a}</button>
            ))}
          </div>
          <button onClick={handleGenerate} disabled={busy}
            className="cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40 ml-auto">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {busy ? '生成中…' : cells.length > 0 ? '重出一批' : '生成候选'}
          </button>
        </div>

        {/* grid body */}
        <div className="flex-1 overflow-y-auto p-5">
          {cells.length === 0 && !busy ? (
            <div className="text-center py-12 cinema-mono text-[12px] opacity-50">
              点「生成候选」一次出 {count} 个**构图各异**的候选帧,挑最好的那张作首帧。
            </div>
          ) : (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}>
              {cells.map((c) => (
                <button
                  key={c.id}
                  onClick={() => c.imageUrl && handlePick(c.id)}
                  disabled={!c.imageUrl || busy || !!picking}
                  className={`group relative ${aspectClass} rounded-lg overflow-hidden border border-[var(--cinema-border)] bg-black/40 hover:border-[var(--cinema-amber)] focus:outline-none focus:border-[var(--cinema-amber)] disabled:cursor-default transition-colors`}
                  title={c.variantLabel}
                >
                  {c.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img loading="lazy" decoding="async" src={c.imageUrl} alt={c.variantLabel} className="w-full h-full object-cover" />
                  ) : c.error ? (
                    <div className="w-full h-full grid place-items-center text-center px-1"><ImageOff className="w-5 h-5 opacity-40" /></div>
                  ) : (
                    <div className="w-full h-full grid place-items-center"><Loader2 className="w-5 h-5 animate-spin opacity-50" /></div>
                  )}
                  {/* 取向标签 */}
                  <span className="absolute left-1.5 bottom-1.5 cinema-mono text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-white/85">{c.variantLabel}</span>
                  {/* 采用态 */}
                  {picking === c.id ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/50"><Loader2 className="w-6 h-6 animate-spin text-[var(--cinema-amber)]" /></div>
                  ) : c.imageUrl ? (
                    <div className="absolute inset-0 grid place-items-center bg-[var(--cinema-amber)]/0 group-hover:bg-black/40 transition-colors">
                      <span className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 cinema-mono text-[11px] px-2 py-1 rounded bg-[var(--cinema-amber)] text-black font-semibold transition-opacity"><Check className="w-3.5 h-3.5" />采用</span>
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {error && <div className="cinema-card p-3 border-[var(--cinema-red)]/40 mt-4"><span className="cinema-mono text-[11px] text-[var(--cinema-red)]">✗ {error}</span></div>}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between">
          <span className="cinema-mono text-[10px] opacity-50">
            {busy ? status : `${ready}/${cells.length || count} 就绪 · 点一张即设为该镜首帧`}
          </span>
          <button onClick={onCancel} disabled={busy || !!picking} className="cinema-btn !px-3 !py-1.5 !text-[11px] disabled:opacity-40">关闭</button>
        </div>
      </div>
    </div>
  );
}
