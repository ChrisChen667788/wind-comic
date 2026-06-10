'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, WarningCircle as AlertCircle, ArrowsOutSimple as Maximize2, SpeakerHigh as Volume2, SpeakerSlash as VolumeX } from '@phosphor-icons/react';
import { useFocusTrap } from '@/hooks/use-focus-trap';

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

  // v10.3.6 a11y: Escape + 焦点陷阱 + 焦点归还(替代原 document Escape 监听)
  const dialogRef = useFocusTrap<HTMLDivElement>(open && mounted, handleClose);

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
        aria-hidden="true"
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={handleClose}
      />

      {/* 视频容器 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || '视频预览'}
        tabIndex={-1}
        className="relative w-[90vw] max-w-5xl rounded-2xl overflow-hidden bg-black border border-white/8 shadow-2xl outline-none"
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
          <div className="w-full aspect-video bg-black flex flex-col items-center justify-center gap-3 px-8 text-center">
            <AlertCircle className="w-8 h-8 text-yellow-500/60" />
            <p className="text-sm text-gray-300 font-medium">视频加载失败</p>
            {/* v2.12 fix: 给具体可操作的指引,不要只甩个失败 */}
            <div className="text-xs text-gray-400 leading-relaxed max-w-md">
              {src.startsWith('/api/serve-file?path=') ? (
                <>
                  本地合成视频文件已失效。
                  {src.includes('/tmp/') || src.includes('/var/folders/') ? (
                    <>
                      <br />
                      <span className="text-yellow-300/70">
                        这是 v2.18.1 之前的老成片 (写在 /tmp 里, 已被系统清理)。
                        v2.18.1 起新成片写在持久化 data/composed/ 下, 不再消失。
                      </span>
                    </>
                  ) : null}
                  <br />
                  <span className="text-yellow-300/70">解决方案:回创作工坊重跑该项目, 新成片会自动持久化。</span>
                </>
              ) : src.includes('minimax') || src.includes('aliyuncs') ? (
                <>
                  上游 CDN URL 已过期(Minimax 视频通常 24h 后失效)。
                  <br />
                  <span className="text-yellow-300/70">解决方案:点项目页"重新生成此镜"重跑视频环节。</span>
                </>
              ) : !src ? (
                <>
                  成片地址为空 — 上游视频 API 全部失败(可能是 quota 不足或网络异常)。
                  <br />
                  <span className="text-yellow-300/70">解决方案:去 /dashboard/billing 检查 Minimax / Veo / Kling 余额,补充后重跑。</span>
                </>
              ) : (
                <>视频源不可访问。可能是 CORS / 文件不存在 / 网络异常。</>
              )}
            </div>
            {src && (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                在新窗口中打开视频
              </a>
            )}
          </div>
        ) : (
          <img loading="lazy" decoding="async" src={src} alt={title || ''} className="w-full aspect-video object-contain bg-black" />
        )}
      </div>
    </div>,
    document.body
  );
}
