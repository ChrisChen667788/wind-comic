'use client';

/**
 * v5.0.2 — 环形进度条 (SVG ring).
 *
 * 可控 value (0-100) 的环形进度. 用于长任务 (I2V 生成等) 的可视反馈.
 * 纯展示, 不含计时逻辑 — 进度由调用方喂 (真实 or 时间估算).
 */

export interface CircularProgressProps {
  /** 0-100. */
  value: number;
  /** 直径 px. */
  size?: number;
  /** 环宽 px. */
  stroke?: number;
  /** 中心主文案 (默认显示百分比). */
  label?: string;
  /** 中心副文案 (小字). */
  sublabel?: string;
  /** 进度色. */
  color?: string;
  /** 轨道色. */
  trackColor?: string;
  /** 是否给进度环加轻微脉冲动画 (任务进行中). */
  pulse?: boolean;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function CircularProgress({
  value,
  size = 132,
  stroke = 9,
  label,
  sublabel,
  color = '#E8C547',
  trackColor = 'rgba(255,255,255,0.10)',
  pulse = false,
}: CircularProgressProps) {
  const v = clamp(value);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - v / 100);
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={pulse ? 'animate-pulse-slow' : ''} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={center} cy={center} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>{label ?? `${Math.round(v)}%`}</span>
        {sublabel && <span className="text-[10px] text-white/50 mt-0.5 px-2">{sublabel}</span>}
      </div>
    </div>
  );
}
