'use client';

/**
 * components/project/composition-guide (v7.5) — 构图引导叠层 + 运镜路径 mini-viz
 * (对标 CineMatrix Composition Guide / Camera Movement Path)
 *
 * 给定景别/机位/运镜 → 三分法网格 (可叠在预览图上) + 构图建议 (主体/头部/视线/平衡) + 运镜路径图。
 */

import { computeCompositionHints, cameraPathPoints } from '@/lib/composition';
import type { ShotSize, CameraAngle, MovementId } from '@/lib/cinematography';

export function CompositionGuide({ shotSize, angle, movement, imageUrl }: {
  shotSize?: ShotSize;
  angle?: CameraAngle;
  movement?: MovementId;
  imageUrl?: string;
}) {
  const hints = computeCompositionHints({ shotSize, angle });
  const path = cameraPathPoints(movement || 'static');

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* 三分法取景框 */}
      <div>
        <div className="cinema-eyebrow mb-1">构图取景 · 三分法</div>
        <div className="relative w-full rounded-md overflow-hidden border border-[var(--border)]" style={{ aspectRatio: '16 / 9' }}>
          {imageUrl
            ? <img loading="lazy" decoding="async" src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 bg-[var(--surface)]" />}
          <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
            {/* 三分线 */}
            <line x1="33.3" y1="0" x2="33.3" y2="56" stroke="rgba(232,197,71,0.5)" strokeWidth="0.3" />
            <line x1="66.6" y1="0" x2="66.6" y2="56" stroke="rgba(232,197,71,0.5)" strokeWidth="0.3" />
            <line x1="0" y1="18.6" x2="100" y2="18.6" stroke="rgba(232,197,71,0.5)" strokeWidth="0.3" />
            <line x1="0" y1="37.3" x2="100" y2="37.3" stroke="rgba(232,197,71,0.5)" strokeWidth="0.3" />
            {/* 交点 (兴趣点) */}
            {[33.3, 66.6].flatMap((x) => [18.6, 37.3].map((y) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="rgba(232,197,71,0.85)" />
            )))}
          </svg>
        </div>
      </div>

      {/* 构图建议 + 运镜路径 */}
      <div className="flex flex-col gap-2">
        <div className="cinema-eyebrow">构图建议</div>
        <div className="grid grid-cols-2 gap-1.5">
          {([['主体位置', hints.facePosition], ['头部空间', hints.headroom], ['视线空间', hints.lookRoom], ['画面平衡', hints.balance]] as const).map(([k, v]) => (
            <div key={k} className="rounded-md border border-[var(--border)] px-2 py-1">
              <div className="cinema-mono text-[9px] opacity-50">{k}</div>
              <div className="text-[10px] leading-tight">{v}</div>
            </div>
          ))}
        </div>

        {/* 运镜路径 */}
        <div className="cinema-eyebrow mt-1">运镜路径 · {path.label}</div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-1">
          <svg viewBox="0 0 100 56" className="w-full" style={{ height: 56 }}>
            <defs>
              <marker id="cg-arrow" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)" />
              </marker>
            </defs>
            <path d={path.path} fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" markerEnd="url(#cg-arrow)" />
            {/* 相机起点 */}
            <circle cx={path.startX} cy={path.startY} r="1.8" fill="var(--muted)" />
            {/* 焦点 */}
            <circle cx={path.focusX} cy={path.focusY} r="2.2" fill="none" stroke="var(--primary)" strokeWidth="0.8" />
            <circle cx={path.focusX} cy={path.focusY} r="0.8" fill="var(--primary)" />
          </svg>
          <div className="flex justify-between cinema-mono text-[9px] opacity-50 px-1">
            <span>● 机位</span><span className="text-[var(--primary)]">◎ 焦点</span>
          </div>
        </div>
      </div>
    </div>
  );
}
