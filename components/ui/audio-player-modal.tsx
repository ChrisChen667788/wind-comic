'use client';

/**
 * AudioPlayerModal — 配乐资产专用播放器。
 *
 * 之前素材库的 music 资产点击只调用 `new Audio(url).play()`:
 *   1) 没有 UI 反馈,用户不知道有没有开始播
 *   2) 没有进度条,不能拖
 *   3) 无法暂停,只能刷页面
 *
 * 本组件提供最小可用的音乐播放器:播放/暂停、进度条、时间轴、拖动 seek、
 * ESC 关闭、Space 空格切换播放/暂停。
 *
 * 选型理由:
 *   直接用原生 <audio controls> 也能跑,但它的 UI 跨浏览器不统一(Safari 会拉宽整条),
 *   且和整站的暗色玻璃拟态风格冲突。自己实现一层壳,拿到样式主动权。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, Music } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  title?: string;
  /** 可选的描述/标签 (例如 "MV Mode · 110bpm") */
  subtitle?: string;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function AudioPlayerModal({ open, onOpenChange, src, title, subtitle }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // 关闭时停止播放
  const handleClose = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // ESC 关闭 + Space 切播/停
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
      if (e.key === ' ' || e.code === 'Space') {
        // 避免滚页
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handleClose]);

  // open 时自动加载 + 尝试播放
  useEffect(() => {
    if (!open || !src) return;
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    const a = audioRef.current;
    if (!a) return;
    a.src = src;
    a.load();
    // 自动播放可能被浏览器拦截(需要用户手势),所以静默 catch
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    return () => {
      a.pause();
    };
  }, [open, src]);

  // 锁 body 滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setPlaying(true)).catch((e) => {
        setError(e?.message || '播放失败');
      });
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const pct = Number(e.target.value);
    const t = (pct / 100) * duration;
    a.currentTime = t;
    setCurrentTime(t);
  };

  if (!open || !mounted) return null;

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={handleClose}
      />

      <div
        className="relative w-[92vw] max-w-md rounded-2xl overflow-hidden bg-[var(--surface)] border border-[var(--border)] shadow-2xl"
        style={{ animation: 'zoomIn 0.2s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 */}
        <div className="flex items-start justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl grid place-items-center bg-indigo-500/15 text-indigo-400 shrink-0">
              <Music className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-white truncate">{title || '配乐'}</h3>
              {subtitle ? (
                <p className="text-[11px] text-[var(--muted)] truncate">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            title="关闭 (ESC)"
          >
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>

        {/* 播放控制 */}
        <div className="p-6 flex flex-col gap-4">
          {/* 大播放按钮 */}
          <div className="flex justify-center">
            <button
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-[#E8C547]/90 hover:bg-[#E8C547] text-black grid place-items-center transition-all hover:scale-105 active:scale-95"
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
            </button>
          </div>

          {/* 进度条 */}
          <div>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={pct}
              onChange={handleSeek}
              disabled={!duration}
              className="w-full accent-[#E8C547] cursor-pointer"
              style={{
                background: `linear-gradient(to right, #E8C547 ${pct}%, rgba(255,255,255,0.15) ${pct}%)`,
                height: '4px',
                borderRadius: '4px',
                appearance: 'none',
                outline: 'none',
              }}
            />
            <div className="flex justify-between text-[11px] text-[var(--muted)] mt-2 font-mono">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {error ? (
            <div className="text-center text-[12px] text-red-400/80 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
              {error}
            </div>
          ) : null}

          <p className="text-[10px] text-center text-[var(--muted)] tracking-wider">
            SPACE 播放 / 暂停 · ESC 关闭
          </p>
        </div>

        {/* 隐藏的真实 audio 元素 */}
        <audio
          ref={audioRef}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onEnded={() => setPlaying(false)}
          onError={() => setError('音频加载失败,可能是链接已过期或格式不支持')}
          preload="metadata"
        />
      </div>
    </div>,
    document.body,
  );
}
