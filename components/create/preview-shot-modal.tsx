'use client';

/**
 * components/create/preview-shot-modal (v2.18 P1.3)
 *
 * "试拍 1 镜" modal — 拉 /api/preview-shot, 显示出图 + (可选) 5s 视频 + 决断按钮。
 *
 * 用户路径:
 *   create 页 ROLL 旁边 "试拍" → 弹此 modal → 30-60s loading → 出图 + 视频
 *   → 用户决定: "用这个风格走全流程" / "再试一个" / "放弃"
 */

import { useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, Check, Sparkles, AlertTriangle } from 'lucide-react';

interface PreviewResult {
  imageUrl: string;
  videoUrl?: string;
  prompt: string;
  style: string;
  aspect: string;
  elapsedMs: number;
  warnings?: string[];
}

export interface PreviewShotModalProps {
  idea: string;
  style: string;
  aspect: string;
  videoToo?: boolean;
  /** 用户点 "用这个走全流程" → 父组件触发完整 ROLL */
  onAccept: () => void;
  onCancel: () => void;
}

export function PreviewShotModal({
  idea, style, aspect, videoToo = true, onAccept, onCancel,
}: PreviewShotModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [tryWithVideo, setTryWithVideo] = useState(videoToo);

  const fetchPreview = async (withVideo: boolean) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/preview-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, style, aspect, videoToo: withVideo }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `请求失败 (${res.status})`);
        return;
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : '试拍失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPreview(tryWithVideo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea, style, aspect]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] shadow-2xl flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-5 py-3 border-b border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--cinema-amber)]" />
            <h3 className="text-sm font-semibold text-[var(--cinema-text)]">
              试拍 · 1 镜端到端
            </h3>
            {result && (
              <span className="cinema-mono text-[10px] opacity-60">
                {(result.elapsedMs / 1000).toFixed(1)}s · {result.style} · {result.aspect}
              </span>
            )}
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="cinema-card p-4 border-[var(--cinema-red)]/40">
              <div className="flex items-center gap-2 cinema-mono text-[12px] text-[var(--cinema-red)]">
                <AlertTriangle className="w-4 h-4" />
                ✗ {error}
              </div>
              <button
                onClick={() => fetchPreview(tryWithVideo)}
                className="cinema-btn !text-[11px] mt-3 inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                重试
              </button>
            </div>
          )}

          {loading && (
            <div className="py-12 flex flex-col items-center gap-3 text-[var(--cinema-text-2)]">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--cinema-amber)]" />
              <p className="cinema-mono text-[11px] opacity-70">
                {tryWithVideo ? '出图 + 5s 视频生成中, 通常 30-60s ...' : '出图中, 通常 15-30s ...'}
              </p>
              <p className="cinema-mono text-[10px] opacity-40">
                试拍只动 1 镜 + MJ + Minimax I2V, 不消耗完整 pipeline 算力
              </p>
            </div>
          )}

          {result && !loading && (
            <>
              <div className="cinema-card-hi p-3">
                <div className="cinema-mono text-[10px] opacity-50 tracking-widest mb-2">SHOT PREVIEW</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.imageUrl}
                  alt="试拍图"
                  className="w-full rounded border border-[var(--cinema-border)]"
                />
                {result.videoUrl && (
                  <div className="mt-3">
                    <div className="cinema-mono text-[10px] opacity-50 tracking-widest mb-2">5s VIDEO</div>
                    <video
                      src={result.videoUrl}
                      controls
                      autoPlay
                      muted
                      loop
                      className="w-full rounded border border-[var(--cinema-border)]"
                    />
                  </div>
                )}
              </div>

              {result.warnings && result.warnings.length > 0 && (
                <div className="cinema-card p-3 border-[var(--cinema-amber)]/40">
                  <div className="cinema-mono text-[10px] tracking-widest opacity-60 mb-1">WARNINGS</div>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="cinema-mono text-[11px] text-[var(--cinema-amber)]">⚠️ {w}</div>
                  ))}
                </div>
              )}

              <div className="cinema-card p-3">
                <div className="cinema-mono text-[10px] tracking-widest opacity-60 mb-1">USED PROMPT</div>
                <p className="cinema-mono text-[11px] opacity-80 leading-relaxed">{result.prompt}</p>
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between gap-2 flex-wrap">
          <label className="cinema-mono text-[10px] opacity-60 inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={tryWithVideo}
              onChange={(e) => setTryWithVideo(e.target.checked)}
              disabled={loading}
            />
            包含 5s 视频 (慢一点, 但能看到运镜效果)
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchPreview(tryWithVideo)}
              disabled={loading}
              className="cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              再试一次
            </button>
            <button
              onClick={onCancel}
              className="cinema-btn !px-3 !py-1.5 !text-[11px]"
            >
              放弃
            </button>
            <button
              onClick={onAccept}
              disabled={!result || loading || !!error}
              className="cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Check className="w-3 h-3" />
              用这个风格走全流程
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
