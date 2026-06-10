'use client';

/**
 * v2.23 P0.2 — Storyboard image regen modal.
 *
 * 让用户在 workshop 里改 prompt 重生某一镜的分镜图. 不是重生视频 (那是
 * regenerate-shot), 而是仅画面.
 *
 * UX:
 *   - 显示当前分镜图缩略图 + 原 prompt
 *   - 文本框让用户编辑 prompt
 *   - 切换: 是否锁 Style Bible (默认 on), 是否锁主角脸 (默认 on)
 *   - "重生" 按钮 → SSE 流式拉新图
 *   - 完成后调 onComplete(newUrl)
 */

import { useState } from 'react';
import { X, CircleNotch as Loader2, ArrowsClockwise as RefreshCw, Sparkle as Sparkles, ImageBroken as ImageOff, Upload, Image as ImagePlus } from '@phosphor-icons/react';
import { useFocusTrap } from '@/hooks/use-focus-trap';

export interface StoryboardRegenModalProps {
  projectId: string;
  shotNumber: number;
  currentImageUrl?: string;
  currentPrompt?: string;
  defaultAspectRatio?: string;
  onComplete: (newImageUrl: string, newPrompt: string) => void;
  onCancel: () => void;
}

export function StoryboardRegenModal({
  projectId, shotNumber, currentImageUrl, currentPrompt, defaultAspectRatio,
  onComplete, onCancel,
}: StoryboardRegenModalProps) {
  const [prompt, setPrompt] = useState(currentPrompt || '');
  const [useStyleBible, setUseStyleBible] = useState(true);
  const [useCref, setUseCref] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio || '16:9');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // v2.24 B: 用户上传的参考图 URL (服务端持久化后的 http URL)
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // v10.3.6 a11y: Escape + 焦点陷阱 + 焦点归还(此前无任何键盘关闭路径);重生中不响应 Escape
  const dialogRef = useFocusTrap<HTMLDivElement>(true, () => { if (!busy) onCancel(); });

  const handleUploadFile = async (file: File) => {
    if (uploading || busy) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('参考图过大 (上限 10MB)');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/character-face', {
        method: 'POST',
        body: form,
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body?.error || `上传失败 (${res.status})`);
        return;
      }
      setRefImageUrl(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (uploading || busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await handleUploadFile(file);
    }
  };

  const handleRegen = async () => {
    if (busy) return;
    const trimmed = prompt.trim();
    if (trimmed.length < 5) {
      setError('prompt 不能短于 5 字');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus('启动重生...');

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/regenerate-storyboard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shotNumber,
            customPrompt: trimmed,
            useStyleBible,
            useCref,
            aspectRatio,
            // v2.24 B: 用户上传的参考图 (作 sref 优先于 Style Bible)
            referenceImageUrl: refImageUrl || undefined,
          }),
        },
      );
      if (!res.ok && !res.body) {
        const txt = await res.text().catch(() => '');
        setError(`请求失败 (${res.status}): ${txt.slice(0, 120)}`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setError('无法读取响应流');
        return;
      }
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'status') {
              setStatus(evt.data?.message || '处理中...');
            } else if (evt.type === 'complete') {
              const newUrl = evt.data?.imageUrl;
              if (newUrl) {
                onComplete(newUrl, evt.data?.prompt || trimmed);
                return; // close 流程交给父组件
              } else {
                setError('上游未返新图');
              }
            } else if (evt.type === 'error') {
              setError(evt.data?.message || '重生失败');
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '重生失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={`改 prompt 重生 · Shot ${shotNumber}`}
      tabIndex={-1}
    >
      <div className="w-full max-w-2xl max-h-[90vh] rounded-2xl bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] shadow-2xl flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-5 py-3 border-b border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--cinema-amber)]" />
            <h3 className="text-sm font-semibold text-[var(--cinema-text)]">
              改 prompt 重生 · Shot {shotNumber}
            </h3>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 当前图 */}
          <div className="cinema-card-hi p-3">
            <div className="cinema-eyebrow mb-2">CURRENT IMAGE</div>
            {currentImageUrl && /^https?:|^\/api\//i.test(currentImageUrl) ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img loading="lazy" decoding="async" 
                src={currentImageUrl}
                alt={`Shot ${shotNumber} current`}
                className="w-full max-h-64 object-contain rounded border border-[var(--cinema-border)] bg-black/40" />
            ) : (
              <div className="w-full h-32 rounded border border-[var(--cinema-border)] bg-black/40 grid place-items-center">
                <ImageOff className="w-6 h-6 opacity-40" />
              </div>
            )}
          </div>

          {/* prompt 编辑 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="cinema-eyebrow">EDIT PROMPT</label>
              <span className="cinema-mono text-[10px] opacity-50">{prompt.length}/2000</span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              maxLength={2000}
              disabled={busy}
              placeholder="改写镜头描述... 例: 把主角换成俯拍角度, 加强情绪冲击"
              className="w-full px-3 py-2 cinema-mono text-[12px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded focus:outline-none focus:border-[var(--cinema-amber)] resize-y disabled:opacity-50"
            />
          </div>

          {/* v2.24 B: 用户上传参考图 (拖拽或点击) — 优先级高于 Style Bible */}
          <div
            className="cinema-card-hi p-3 space-y-2"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="cinema-eyebrow flex items-center gap-1.5">
                <ImagePlus className="w-3 h-3" />
                参考图 (可选, 优先于 Style Bible)
              </div>
              {refImageUrl && (
                <button
                  onClick={() => setRefImageUrl(null)}
                  disabled={busy || uploading}
                  className="cinema-mono text-[10px] opacity-60 hover:text-red-300 disabled:opacity-30"
                >
                  ✕ 移除
                </button>
              )}
            </div>
            {refImageUrl ? (
              <div className="flex gap-2 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" decoding="async" 
                  src={refImageUrl}
                  alt="reference"
                  className="w-24 h-16 object-cover rounded border border-[var(--cinema-amber)]/40" />
                <div className="flex-1 min-w-0">
                  <div className="cinema-mono text-[10px] opacity-80">✓ 已上传参考图</div>
                  <div className="cinema-mono text-[9px] opacity-50 break-all line-clamp-2 mt-0.5">
                    {refImageUrl}
                  </div>
                  <div className="cinema-mono text-[9px] opacity-60 mt-1">
                    本次重生会以这张图作 sref (替代 Style Bible)
                  </div>
                </div>
              </div>
            ) : (
              <label
                className={`flex items-center justify-center gap-2 px-4 py-6 border border-dashed rounded cursor-pointer transition-colors ${
                  busy || uploading
                    ? 'opacity-50 cursor-not-allowed'
                    : 'border-[var(--cinema-border)] hover:border-[var(--cinema-amber)]'
                }`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin opacity-60" />
                    <span className="cinema-mono text-[11px] opacity-60">上传中...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 opacity-60" />
                    <span className="cinema-mono text-[11px] opacity-60">
                      拖一张参考图到此 (或点击选择) — 模型会按这张图风格出
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy || uploading}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await handleUploadFile(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* 选项 */}
          <div className="cinema-card-hi p-3 space-y-2">
            <div className="cinema-eyebrow mb-1">OPTIONS</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useStyleBible}
                onChange={(e) => setUseStyleBible(e.target.checked)}
                disabled={busy}
              />
              <span className="cinema-mono text-[11px]">
                锁 Style Bible 画风 (推荐, 防画风跳脱)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useCref}
                onChange={(e) => setUseCref(e.target.checked)}
                disabled={busy}
              />
              <span className="cinema-mono text-[11px]">
                锁主角脸 (用 primaryCharacterRef 作 cref)
              </span>
            </label>
            <div className="flex items-center gap-2 pt-1">
              <span className="cinema-mono text-[11px] opacity-60">画幅:</span>
              {(['16:9', '9:16', '1:1', '2.35:1'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAspectRatio(a)}
                  disabled={busy}
                  className={`cinema-mono text-[10px] px-2 py-0.5 rounded border ${
                    aspectRatio === a
                      ? 'bg-[var(--cinema-amber)]/20 border-[var(--cinema-amber)] text-[var(--cinema-amber)]'
                      : 'border-[var(--cinema-border)] opacity-60 hover:opacity-100'
                  } disabled:opacity-30`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* 状态 / 错误 */}
          {busy && (
            <div className="cinema-card p-3 border-[var(--cinema-amber)]/30 inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--cinema-amber)]" />
              <span className="cinema-mono text-[11px] opacity-80">{status}</span>
            </div>
          )}
          {error && (
            <div className="cinema-card p-3 border-[var(--cinema-red)]/40">
              <span className="cinema-mono text-[11px] text-[var(--cinema-red)]">✗ {error}</span>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between">
          <span className="cinema-mono text-[10px] opacity-50">
            走完整 image 路由 (multi-ref + style bible + 文字负向 prompt)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="cinema-btn !px-3 !py-1.5 !text-[11px] disabled:opacity-40"
            >
              取消
            </button>
            <button
              onClick={handleRegen}
              disabled={busy || prompt.trim().length < 5}
              className="cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {busy ? '重生中...' : '重生这一镜'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
