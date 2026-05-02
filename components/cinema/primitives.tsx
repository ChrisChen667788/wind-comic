'use client';

/**
 * Cinema 视觉 primitive — 跟 oiioii 拉开签名距离的影院专属组件
 *
 * 全部用 cinema-theme.css 里的 css var,只在 .cinema-page 容器下生效。
 *
 * 设计原则:
 *   - 影院/dashboard/Logic Pro 三家视觉合体
 *   - 不抄 oiioii 的粉色 / blob mascot / 点阵画布
 *   - 信息密度高,但层级清晰
 */

import type { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────
// TimecodeChip — 影院时码 00:00:05:12 (帧级别)
// ──────────────────────────────────────────────────────────
export function TimecodeChip({
  seconds,
  fps = 24,
  variant = 'default',
}: {
  seconds: number;
  fps?: number;
  variant?: 'default' | 'amber';
}) {
  const totalFrames = Math.round(seconds * fps);
  const f = totalFrames % fps;
  const total_s = Math.floor(totalFrames / fps);
  const s = total_s % 60;
  const m = Math.floor(total_s / 60) % 60;
  const h = Math.floor(total_s / 3600);
  const tc = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
  return (
    <span className={`cinema-chip ${variant === 'amber' ? 'cinema-chip-amber' : ''}`}>
      <span className="cinema-mono">{tc}</span>
    </span>
  );
}
function pad(n: number) { return n.toString().padStart(2, '0'); }

// ──────────────────────────────────────────────────────────
// AspectChip — 画幅比例 (16:9 · 1.85:1 · 2.35:1)
// ──────────────────────────────────────────────────────────
export function AspectChip({ ratio }: { ratio: string }) {
  const cinemaName: Record<string, string> = {
    '16:9': 'WIDESCREEN',
    '9:16': 'VERTICAL',
    '1:1': 'SQUARE',
    '2.35:1': 'CINEMASCOPE',
    '1.85:1': 'STANDARD',
    '4:3': 'ACADEMY',
  };
  const label = cinemaName[ratio];
  return (
    <span className="cinema-chip">
      <span className="cinema-mono">{ratio}</span>
      {label && <span className="text-[8px] opacity-50 tracking-widest">· {label}</span>}
    </span>
  );
}

// ──────────────────────────────────────────────────────────
// FilmStripDivider — 装饰性胶片孔洞分隔
// ──────────────────────────────────────────────────────────
export function FilmStripDivider({ label }: { label?: string }) {
  if (!label) return <div className="cinema-filmstrip" />;
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="cinema-filmstrip flex-1" />
      <span className="cinema-eyebrow whitespace-nowrap">{label}</span>
      <div className="cinema-filmstrip flex-1" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TechReadout — 等宽技术读数,Notion-code 风
// ──────────────────────────────────────────────────────────
export function TechReadout({
  pairs,
}: {
  pairs: Array<[string, ReactNode]>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 cinema-mono text-[11px]">
      {pairs.map(([k, v], i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="opacity-50">{k}</span>
          <span className="cinema-inline-code">{v}</span>
        </span>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Eyebrow — 等宽小标签 (RUNNING / READY / CUE)
// ──────────────────────────────────────────────────────────
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="cinema-eyebrow">{children}</span>;
}

// ──────────────────────────────────────────────────────────
// SlateCard — 电影场记板风格的卡片头
// 灵感:剧组拍摄前在板子上写片名 + 场号,这里把项目标题做成"slate"
// ──────────────────────────────────────────────────────────
export function SlateCard({
  title,
  scene,
  take,
  director,
  notes,
}: {
  title: string;
  scene?: string;
  take?: string;
  director?: string;
  notes?: string;
}) {
  return (
    <div className="cinema-card-hi p-5 relative overflow-hidden">
      {/* 顶部斜纹装饰 — 模拟黑白场记板 */}
      <div
        className="absolute top-0 left-0 right-0 h-2 opacity-30"
        style={{
          background:
            'repeating-linear-gradient(45deg, var(--cinema-text), var(--cinema-text) 8px, var(--cinema-bg) 8px, var(--cinema-bg) 16px)',
        }}
      />
      <div className="pt-3 grid grid-cols-[auto_1fr_auto_auto] gap-x-6 gap-y-2 items-baseline">
        <Eyebrow>SCENE</Eyebrow>
        <span className="cinema-mono text-sm">{scene || '—'}</span>
        <Eyebrow>TAKE</Eyebrow>
        <span className="cinema-mono text-sm">{take || '—'}</span>
      </div>
      <h1 className="cinema-headline text-3xl mt-3 mb-1">{title}</h1>
      {director && (
        <div className="cinema-mono text-[11px] opacity-60">
          DIR · {director}
        </div>
      )}
      {notes && (
        <p className="cinema-subhead text-sm mt-2 opacity-75">{notes}</p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// StatusBar — Logic Pro 风格底部状态栏
// ──────────────────────────────────────────────────────────
export function StatusBar({
  items,
}: {
  items: Array<{
    label: string;
    value?: ReactNode;
    status?: 'green' | 'amber' | 'red' | 'neutral';
  }>;
}) {
  const dotColor = (s?: string) =>
    s === 'green' ? 'var(--cinema-green)' :
    s === 'amber' ? 'var(--cinema-amber)' :
    s === 'red' ? 'var(--cinema-red)' :
    'var(--cinema-text-3)';
  return (
    <div className="cinema-statusbar">
      {items.map((it, i) => (
        <span key={i} className="cinema-statusbar-item">
          {it.status && (
            <span
              className="cinema-statusbar-dot"
              style={{ background: dotColor(it.status) }}
            />
          )}
          <span className="opacity-50">{it.label}</span>
          {it.value !== undefined && (
            <span className="opacity-90">{it.value}</span>
          )}
          {i < items.length - 1 && <span className="opacity-20 ml-3">│</span>}
        </span>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// MeterBar — 0-100 数值条 (Cameo 一致性 / cw 强度等)
// ──────────────────────────────────────────────────────────
export function MeterBar({
  value,
  max = 100,
  label,
  variant,
}: {
  value: number;
  max?: number;
  label?: string;
  variant?: 'amber' | 'red' | 'auto';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const v = variant === 'auto' ? (value < 60 ? 'red' : 'amber') : (variant || 'amber');
  return (
    <div className="flex items-center gap-2">
      {label && <span className="cinema-eyebrow w-12">{label}</span>}
      <div className="cinema-meter flex-1">
        <div
          className={`cinema-meter-fill ${v === 'red' ? 'cinema-meter-fill-red' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="cinema-mono text-[11px] w-8 text-right opacity-80">{Math.round(value)}</span>
    </div>
  );
}
