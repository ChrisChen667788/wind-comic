'use client';

/**
 * components/project/cover-candidates-panel (v9.1.3) — AI 竖屏封面候选.
 *
 * 一键按 片名+主角+画风 生成 3 张 9:16 封面 (MiniMax image-01) → 每张在 9:16 框里展示,
 * 叠「标题安全区」虚线 + 标题文字预览 (标题不烧进图, 前端叠层)。可切换安全区显隐 + 逐张下载。
 * 挂载即 GET 回填已落库封面。
 */

import { useEffect, useState } from 'react';
import { ImageSquare, DownloadSimple, Sparkle, Eye, EyeSlash, WarningCircle as AlertCircle, CircleNotch } from '@phosphor-icons/react';
import { getTitleSafeArea, type CoverCandidate, type TitleSafeArea } from '@/lib/cover-candidates';

export function CoverCandidatesPanel({ projectId, title: titleProp }: { projectId: string; title?: string }) {
  const [candidates, setCandidates] = useState<CoverCandidate[]>([]);
  const [safeArea, setSafeArea] = useState<TitleSafeArea>(getTitleSafeArea());
  const [title, setTitle] = useState(titleProp || '');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/covers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setCandidates(d.candidates || []);
        if (d.safeArea) setSafeArea(d.safeArea);
        if (d.title) setTitle(d.title);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  async function generate() {
    setLoading(true); setErr(''); setDegraded(false);
    try {
      const r = await fetch(`/api/projects/${projectId}/covers`, { method: 'POST' });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        setErr(d?.error || '生成失败, 请稍后再试');
        if (Array.isArray(d?.candidates)) setCandidates(d.candidates);
      } else {
        setCandidates(d.candidates || []);
        if (d.safeArea) setSafeArea(d.safeArea);
        setDegraded(!!d.degraded);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  }

  const hasImages = candidates.some((c) => c.imageUrl);

  return (
    <div className="cinema-card !p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="cinema-eyebrow flex items-center gap-1.5"><ImageSquare size={13} className="text-[var(--primary)]" /> AI 竖屏封面候选 · 9:16</span>
        <div className="flex items-center gap-2">
          {hasImages && (
            <button onClick={() => setShowOverlay((v) => !v)} className="cinema-btn-ghost !text-[11px]">
              {showOverlay ? <EyeSlash size={13} /> : <Eye size={13} />} {showOverlay ? '隐藏' : '显示'}标题安全区
            </button>
          )}
          <button onClick={generate} disabled={loading} className="cinema-btn-primary !text-[11px]">
            {loading ? <CircleNotch size={13} className="animate-spin" /> : <Sparkle size={13} />}
            {candidates.length ? '重新生成' : '生成封面候选'}
          </button>
        </div>
      </div>

      {err && <div className="flex items-center gap-1.5 text-[var(--secondary)] text-xs mb-2"><AlertCircle size={13} />{err}</div>}
      {degraded && <div className="cinema-mono text-[10px] text-[var(--primary)] mb-2 opacity-80">部分封面出图失败, 已展示成功的几张 (可重新生成)</div>}

      {candidates.length === 0 && !loading && (
        <div className="cinema-mono text-[11px] opacity-50">按 片名 + 主角 + 画风 生成 3 张 9:16 封面候选 (复用 MiniMax image-01)。标题不烧进图, 在「安全区」叠层预览, 避免平台 UI 遮挡。</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {candidates.map((c) => (
          <div key={c.key} className="flex flex-col gap-1.5">
            <div className="relative w-full rounded-lg overflow-hidden border border-[var(--border)] bg-black" style={{ aspectRatio: '9 / 16' }}>
              {c.imageUrl ? (
                <img loading="lazy" decoding="async" src={c.imageUrl} alt={c.label} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-3 text-center">
                  <span className="cinema-mono text-[10px] text-[var(--secondary)]">{c.error || '出图失败'}</span>
                </div>
              )}
              {/* 标题安全区叠层 (虚线带 + 标题文字预览; 标题未烧进图) */}
              {c.imageUrl && showOverlay && (
                <div
                  className="absolute border border-dashed border-white/60 flex items-center justify-center px-2 pointer-events-none"
                  style={{ top: `${safeArea.topPct}%`, left: `${safeArea.leftPct}%`, width: `${safeArea.widthPct}%`, height: `${safeArea.heightPct}%` }}
                >
                  <span
                    className="text-white font-bold text-center leading-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]"
                    style={{ fontSize: 'clamp(11px, 3vw, 20px)' }}
                  >
                    {title || '标题安全区'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="cinema-mono text-[10px] opacity-60">{c.label}</span>
              {c.imageUrl && (
                <a href={c.imageUrl} download target="_blank" rel="noreferrer" className="cinema-btn-ghost !text-[10px] !py-0.5"><DownloadSimple size={12} /> 下载</a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
