'use client';

/**
 * v12.448 — 某一镜的「动作参考视频」。
 *
 * 挂上之后,这一镜出片时会把视频交给 MiniMax H3(role=reference_video),让生成照着它的动作与运镜来。
 * 两种来源:
 *   - 本地上传:服务端探测 + 超过 15 秒自动截取前 15 秒;发送时转 base64(本地地址 MiniMax 访问不到)
 *   - 公网链接:原样交给 MiniMax 去下载
 * **只有 H3 能用,而 H3 只能按量付费** —— 这里必须把话说在前面;出片时用不了会被忽略并提示,不会丢镜。
 */

import { useEffect, useRef, useState } from 'react';
import { X, CircleNotch as Loader2, FilmSlate, Upload, Link as LinkIcon, Trash } from '@phosphor-icons/react';
import { useFocusTrap } from '@/hooks/use-focus-trap';

export interface ShotRefVideoView {
  shotNumber: number;
  url: string;
  source: 'link' | 'upload';
  durationSec?: number;
  trimmedFrom?: number;
  width?: number;
  height?: number;
}

export interface RefVideoModalProps {
  projectId: string;
  shotNumber: number;
  /** 保存 / 取下后回调,镜头工坊据此更新卡片上的标记 */
  onChange: (shotNumber: number, refVideo: ShotRefVideoView | null) => void;
  onClose: () => void;
}

const api = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/ref-video`;

export function RefVideoModal({ projectId, shotNumber, onChange, onClose }: RefVideoModalProps) {
  const [current, setCurrent] = useState<ShotRefVideoView | null>(null);
  const [h3Unavailable, setH3Unavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, () => { if (!busy) onClose(); });

  useEffect(() => {
    let alive = true;
    fetch(`${api(projectId)}?shot=${shotNumber}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; setCurrent(d?.refVideo || null); setH3Unavailable(!!d?.h3KnownUnavailable); })
      .catch(() => { if (alive) setError('读取失败,请重试'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, shotNumber]);

  const applySaved = (d: any) => {
    setCurrent(d.refVideo);
    setH3Unavailable(!!d.h3KnownUnavailable);
    onChange(shotNumber, d.refVideo);
    setNotice(d.refVideo?.trimmedFrom ? `原视频 ${d.refVideo.trimmedFrom} 秒,超过 15 秒上限,已截取前 15 秒` : '已保存');
  };

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const form = new FormData();
      form.append('shotNumber', String(shotNumber));
      form.append('file', file);
      const res = await fetch(api(projectId), { method: 'POST', body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || '上传失败'); return; }
      applySaved(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }

  async function saveLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) { setError('链接必须以 http:// 或 https:// 开头'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(api(projectId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shotNumber, url }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || '保存失败'); return; }
      setLink('');
      applySaved(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`${api(projectId)}?shot=${shotNumber}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || '取下失败'); return; }
      setCurrent(null);
      onChange(shotNumber, null);
      setNotice('已取下');
    } catch (err) {
      setError(err instanceof Error ? err.message : '取下失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm outline-none"
      role="dialog" aria-modal="true" aria-label={`动作参考视频 · Shot ${shotNumber}`} tabIndex={-1}
    >
      <div className="w-full max-w-lg max-h-[90vh] rounded-2xl bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FilmSlate className="w-4 h-4 text-[var(--cinema-amber)]" />
            <h3 className="text-sm font-semibold text-[var(--cinema-text)]">动作参考视频 · Shot {shotNumber}</h3>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="关闭" className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[12px] text-[var(--cinema-text)]">
          <p className="opacity-70 leading-relaxed" data-ref-video-note>
            出片时把这段视频交给 MiniMax H3,照着它的<strong>动作和运镜</strong>生成这一镜(2–15 秒,MP4 / MOV)。
            <br />
            <span className="text-[var(--cinema-amber)]">只有 H3 能用,而 H3 只能按量付费</span>;用不了时这一镜会忽略参考视频照常出片,并在进度里提示。
          </p>
          {h3Unavailable && (
            <div data-h3-unavailable className="cinema-card-hi p-2 text-[11px] text-[var(--cinema-amber)]">
              本服务刚确认当前 MiniMax key 用不了 H3(套餐不支持)—— 现在挂上也会被忽略,换成按量付费的 key 后才生效。
            </div>
          )}

          <div className="cinema-card-hi p-3 space-y-2" data-ref-video-current>
            <div className="cinema-eyebrow">CURRENT</div>
            {loading ? (
              <div className="opacity-60 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />读取中…</div>
            ) : current ? (
              <>
                {/^https?:|^\/api\//i.test(current.url) && (
                  <video src={current.url} controls muted playsInline preload="metadata" className="w-full max-h-56 rounded bg-black" />
                )}
                <div className="cinema-mono text-[10px] opacity-70 break-all">
                  {current.source === 'upload' ? '本地上传' : '公网链接'}
                  {current.durationSec ? ` · ${current.durationSec} 秒` : ''}
                  {current.width ? ` · ${current.width}×${current.height}` : ''}
                  {current.trimmedFrom ? ` · 已从 ${current.trimmedFrom} 秒截取` : ''}
                  {current.source === 'link' ? ` · ${current.url}` : ''}
                </div>
                <button type="button" onClick={remove} disabled={busy} className="cinema-btn !px-2 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40">
                  <Trash className="w-3 h-3" />取下
                </button>
              </>
            ) : (
              <div className="opacity-60">这一镜还没挂参考视频</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="cinema-eyebrow">{current ? '换一段' : '挂一段'}</div>
            <button type="button" data-ref-video-upload onClick={() => fileRef.current?.click()} disabled={busy}
              className="cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}上传本地视频(≤20MB)
            </button>
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime" className="hidden" aria-label="上传参考视频" onChange={onPickFile} />
            <div className="flex items-center gap-1.5">
              <input
                type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="或粘贴公网视频链接 https://…"
                aria-label="参考视频链接"
                className="flex-1 min-w-0 px-2 py-1.5 rounded bg-black/30 border border-white/10 text-[11px]"
              />
              <button type="button" onClick={saveLink} disabled={busy || !link.trim()} aria-label="保存链接"
                className="cinema-btn !px-2 !py-1.5 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40">
                <LinkIcon className="w-3 h-3" />保存
              </button>
            </div>
          </div>

          {error && <div role="alert" className="text-[11px] text-red-400 whitespace-pre-wrap">{error}</div>}
          {notice && !error && <div role="status" className="text-[11px] text-[var(--cinema-green)]">{notice}</div>}
        </div>
      </div>
    </div>
  );
}
