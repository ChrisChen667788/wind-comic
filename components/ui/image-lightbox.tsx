'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';

/**
 * 统一的图片放大查看组件。
 *
 * 两种用法:
 *
 * 1) ZoomableImage — 自带状态,最常见的"点击 img 弹出放大"场景
 *    <ZoomableImage src={url} alt="主角" title="角色名" />
 *
 * 2) ImageLightboxModal — 受控模式,适合画廊(外部管理 index + prev/next)
 *    <ImageLightboxModal src={currentUrl} title="..." onClose={...} onPrev={...} onNext={...} />
 *
 * 设计来源:
 *   - assets/page.tsx 原有 ImagePreviewModal 的成熟实现 (ESC/箭头/z-index=99999/backdrop-blur)
 *   - 提取到 ui/ 目录后全站复用,避免每个调用点重写一遍
 */

interface LightboxProps {
  src: string;
  title?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 右上角可选的"下载/另存"按钮或其他自定义 action */
  extraAction?: ReactNode;
}

export function ImageLightboxModal({
  src, title, onClose, onPrev, onNext, hasPrev, hasNext, extraAction,
}: LightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext && onNext) onNext();
    };
    document.addEventListener('keydown', handler, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      // 阻止 React Flow 等父级组件收到 pointer 事件
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center">
        <div className="absolute -top-10 right-0 flex items-center gap-2">
          {extraAction}
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors p-1"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <img
          src={src}
          alt={title || ''}
          className="max-w-full max-h-[80vh] object-contain rounded-lg select-none"
          draggable={false}
        />
        {title ? <div className="text-white/70 text-sm mt-3">{title}</div> : null}
        {hasPrev && onPrev && (
          <button
            onClick={onPrev}
            className="absolute left-[-50px] top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white transition-colors"
            aria-label="上一张"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {hasNext && onNext && (
          <button
            onClick={onNext}
            className="absolute right-[-50px] top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white transition-colors"
            aria-label="下一张"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ZoomableImageProps {
  src: string;
  alt?: string;
  title?: string;
  /** 外层容器 className（应用到触发器的 div） */
  className?: string;
  /** img 本身 className */
  imgClassName?: string;
  /** 是否显示 hover 时的放大镜图标（默认 true） */
  showHoverIcon?: boolean;
  /** 自定义渲染触发器（取代默认的 <img>） */
  children?: ReactNode;
  /** 是否禁用点击放大（默认 false） */
  disabled?: boolean;
}

/**
 * 自带开/关状态的可点击放大图。最常用的形态。
 *
 * 例: <ZoomableImage src={c.mediaUrls[0]} alt={c.name} title={c.name} className="aspect-[16/9]" />
 */
export function ZoomableImage({
  src, alt, title, className, imgClassName, showHoverIcon = true, children, disabled = false,
}: ZoomableImageProps) {
  const [open, setOpen] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    if (disabled || !src) return;
    // 阻止事件冒泡到 React Flow 节点(否则会触发节点拖拽/选中)
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }, [disabled, src]);

  // Pointer events 版本 - React Flow 把 pointerDown 当做拖拽触发
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <>
      <div
        className={`relative group cursor-zoom-in ${className || ''}`}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
      >
        {children || (
          <img
            src={src}
            alt={alt || title || ''}
            className={imgClassName || 'w-full h-full object-cover'}
            draggable={false}
          />
        )}
        {showHoverIcon && !disabled && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none rounded-[inherit]">
            <div className="bg-black/60 backdrop-blur-sm rounded-full p-1.5">
              <ZoomIn className="w-4 h-4 text-white" />
            </div>
          </div>
        )}
      </div>
      {open && (
        <ImageLightboxModal
          src={src}
          title={title}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
