'use client';

/**
 * v12.44 — 统一镜头检查器 (Shot Inspector).
 * 点分镜图 → 右侧抽屉聚合单镜全部信息与操作:放大预览 + 一致性分 + 画面/对白/机位元数据
 * + 单镜操作(摄影台 / 九宫格选帧·4K 重渲·改 prompt 重生)。把此前散落在 分镜卡/镜头工坊
 * 的入口收进一处。全量 cinema 设计系统。
 */

import { useEffect } from 'react';
import { X, FilmSlate, SquaresFour } from '@phosphor-icons/react';
import { TimecodeChip } from '@/components/cinema/primitives';
import { CameoBadge } from '@/components/cameo/CameoStoryboardWidgets';

export interface InspectShot {
  shotNumber: number;
  imageUrl?: string;
  description?: string;
  dialogue?: string;
  emotion?: string;
  duration?: number;
  /** 透传给 CameoBadge(一致性/参演分) */
  data?: Record<string, unknown>;
  /** describeShotSpec(curSpec) 的机位摘要 */
  specSummary?: string;
}

export function ShotInspector({
  shot,
  frameClass,
  onClose,
  onCinema,
  onWorkshop,
}: {
  shot: InspectShot;
  frameClass: string;
  onClose: () => void;
  /** 单镜头摄影台(景别/机位/运镜/焦点) */
  onCinema: () => void;
  /** 去镜头工坊(九宫格选帧 / 4K 重渲 / 改 prompt 重生) */
  onWorkshop: () => void;
}) {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 bg-black/55 z-40 animate-fade-up" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={`镜头 ${shot.shotNumber} 检查器`}
        className="fixed top-0 right-0 h-full w-[min(380px,92vw)] z-50 bg-[var(--cinema-surface)] border-l border-[var(--cinema-border-hi)] overflow-y-auto shadow-2xl"
      >
        <div className="sticky top-0 z-10 bg-[var(--cinema-surface)] border-b border-[var(--cinema-border)] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="cinema-mono text-[10px] tracking-widest text-[var(--cinema-amber)]">SHOT {String(shot.shotNumber).padStart(2, '0')}</span>
            {shot.duration ? <TimecodeChip seconds={shot.duration} /> : null}
          </div>
          <button onClick={onClose} className="cinema-btn-ghost !p-1.5" aria-label="关闭检查器"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* 放大预览 + 一致性分 */}
          <div className="relative cinema-card overflow-hidden">
            {shot.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot.imageUrl} alt={`镜头 ${shot.shotNumber}`} className={`w-full ${frameClass} object-cover`} />
            ) : (
              <div className={`w-full ${frameClass} grid place-items-center bg-[var(--cinema-surface-2)] cinema-mono text-[11px] opacity-40`}>NO RENDER</div>
            )}
            <div className="absolute top-2 right-2"><CameoBadge data={shot.data || {}} /></div>
          </div>

          {shot.emotion ? <div className="cinema-mono text-[10px] opacity-50">情绪 · {shot.emotion}</div> : null}

          <div>
            <div className="cinema-eyebrow !text-[9px] opacity-60 mb-1">画面描述</div>
            <p className="cinema-subhead text-sm opacity-90 leading-relaxed">{shot.description || '——'}</p>
          </div>

          {shot.dialogue ? (
            <div>
              <div className="cinema-eyebrow !text-[9px] opacity-60 mb-1">对白</div>
              <p className="text-sm text-[var(--cinema-blue)] italic">「{shot.dialogue}」</p>
            </div>
          ) : null}

          {shot.specSummary ? (
            <div>
              <div className="cinema-eyebrow !text-[9px] opacity-60 mb-1">机位</div>
              <p className="cinema-mono text-[11px] opacity-70 leading-relaxed">{shot.specSummary}</p>
            </div>
          ) : null}

          {/* 单镜操作 */}
          <div className="pt-3 border-t border-[var(--cinema-border)] space-y-2">
            <div className="cinema-eyebrow !text-[9px] opacity-50">单镜操作</div>
            <button onClick={onCinema} className="cinema-btn-ghost !text-xs w-full !justify-start">
              <FilmSlate className="w-3.5 h-3.5" />单镜头摄影台 · 景别 / 机位 / 运镜 / 焦点
            </button>
            <button onClick={onWorkshop} className="cinema-btn-ghost !text-xs w-full !justify-start">
              <SquaresFour className="w-3.5 h-3.5" />九宫格选帧 / 4K 重渲 / 改 prompt 重生 →
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
