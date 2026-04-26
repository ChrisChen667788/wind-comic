'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle, Maximize2, Volume2, VolumeX } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  title?: string;
}

function isVideoUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image')) return false;
  if (url.startsWith('data:')) return false;
  // Local API serve endpoint (FFmpeg composed videos)
  if (url.startsWith('/api/serve-file')) return true;
  // Real video file extensions
  if (/\.(mp4|webm|mov|avi|mkv|m3u8|ts)(\?|#|$)/i.test(url)) return true;
  // Known video CDN patterns
  if (/oss.*aliyuncs\.com|cos\..+myqcloud\.com|vod\.|video\./i.test(url)) return true;
  // HTTP URLs that are NOT image extensions → likely video
  if (url.startsWith('http') && !/\.(jpg|jpeg|png|gif|svg|webp|bmp|ico|tiff)(\?|#|$)/i.test(url)) return true;
  return false;
}

export function VideoModal({ open, onOpenChange, src, title }: Props) {
  const [videoError, setVideoError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Reset error state when src changes
  useEffect(() => {
    setVideoError(false);
  }, [src]);

  // ESC key handler
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  }, [open, onOpenChange]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleClose = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    // Pause video
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    onOpenChange(false);
  }, [onOpenChange]);

  const handleVideoError = () => {
    console.warn('[VideoModal] Video playback failed:', src?.slice(0, 100));
    setVideoError(true);
  };

  if (!open || !mounted) return null;

  const isVideo = isVideoUrl(src);

  // 使用 Portal 直接渲染到 body，彻底避免 React Flow CSS transform 的影响
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 背景遮罩 — 点击关闭 */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={handleClose}
      />

      {/* 视频容器 */}
      <div
        className="relative w-[90vw] max-w-5xl rounded-2xl overflow-hidden bg-black border border-white/8 shadow-2xl"
        style={{ animation: 'zoomIn 0.2s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部操作栏 */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 to-transparent">
          {title && (
            <span className="text-xs text-white/80 font-medium px-2">{title}</span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {isVideo && !videoError && src.startsWith('http') && (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="在新窗口中打开"
              >
                <Maximize2 className="w-3.5 h-3.5 text-white/70" />
              </a>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-white/20 transition-colors"
              title="关闭"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* 视频/图片内容 */}
        {isVideo && !videoError ? (
          <video
            ref={videoRef}
            key={src}
            src={src}
            controls
            autoPlay
            playsInline
            className="w-full aspect-video bg-black"
            onError={handleVideoError}
          />
        ) : isVideo && videoError ? (
          <div className="w-full aspect-video bg-black flex flex-col items-center justify-center gap-3">
            <AlertCircle className="w-8 h-8 text-yellow-500/60" />
            <p className="text-xs text-gray-400">视频加载失败</p>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              在新窗口中打开视频
            </a>
          </div>
        ) : (
          <img src={src} alt={title || ''} className="w-full aspect-video object-contain bg-black" />
        )}
      </div>
    </div>,
    document.body
  );
}
