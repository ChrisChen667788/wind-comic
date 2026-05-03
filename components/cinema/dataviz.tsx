'use client';

/**
 * Cinema 数据可视化组件 (v2.13.3 / v2.13.4)
 *
 * 灵感:Tremor BarList / DonutChart 的信息密度,但用 cinema 调色 + 衬线/等宽混排,
 * 不引第三方依赖(Tremor v3 仅支持 React 18,我们是 19)
 *
 * 包含:
 *   <CameoBarList>     — per-shot 横向条状图,颜色按 ≥85 / 70-84 / <70 三档
 *   <CameoDonut>       — 三段式环形,中心显示 AVG
 *   <Sparkline>        — v2.13.4 升级版:渐变面积填充 + 端点高亮 + 自动 trend 配色
 *   <ScoreDonut>       — v2.13.4 项目卡专用单弧 mini donut (28-44px)
 */

import { useMemo, type ReactNode } from 'react';

// ────────────────────────────────────────────────
// 共用:0-100 → 三档色
// ────────────────────────────────────────────────
function tier(score: number | null | undefined) {
  if (typeof score !== 'number') return 'na' as const;
  if (score >= 85) return 'pass' as const;
  if (score >= 70) return 'warn' as const;
  return 'fail' as const;
}
const TIER_COLOR = {
  pass: 'var(--cinema-green)',
  warn: 'var(--cinema-amber)',
  fail: 'var(--cinema-red)',
  na: 'var(--cinema-text-3)',
} as const;

// ────────────────────────────────────────────────
// CameoBarList — 横向条状图
// ────────────────────────────────────────────────
export interface BarListItem {
  shotNumber: number;
  score: number | null;
  retried?: boolean;
}

export function CameoBarList({
  items,
  threshold = 75,
  onClickShot,
  maxRows = 16,
}: {
  items: BarListItem[];
  threshold?: number;
  onClickShot?: (shotNumber: number) => void;
  maxRows?: number;
}) {
  const sorted = useMemo(() => {
    // 把"最低分"排前面,引导用户先看坏的
    return [...items]
      .sort((a, b) => {
        const ax = typeof a.score === 'number' ? a.score : 999;
        const bx = typeof b.score === 'number' ? b.score : 999;
        return ax - bx;
      })
      .slice(0, maxRows);
  }, [items, maxRows]);

  if (sorted.length === 0) {
    return (
      <div className="cinema-mono text-[11px] opacity-50 py-2">NO SCORE DATA</div>
    );
  }

  return (
    <div className="space-y-1">
      {sorted.map((it) => {
        const t = tier(it.score);
        const color = TIER_COLOR[t];
        const widthPct = it.score == null ? 0 : Math.max(2, Math.min(100, it.score));
        const isLow = typeof it.score === 'number' && it.score < threshold;
        return (
          <button
            key={it.shotNumber}
            onClick={() => onClickShot?.(it.shotNumber)}
            className={`w-full flex items-center gap-2 px-2 py-1 text-left transition-colors ${
              onClickShot ? 'hover:bg-[var(--cinema-surface-2)]' : 'cursor-default'
            }`}
            style={{ borderRadius: 3 }}
          >
            <span className="cinema-mono text-[10px] opacity-60 w-12 tracking-wider tabular-nums">
              SHOT {String(it.shotNumber).padStart(2, '0')}
            </span>
            <div className="flex-1 h-2 cinema-meter" style={{ borderRadius: 2 }}>
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${color}66 0%, ${color} 100%)`,
                  opacity: it.score == null ? 0.3 : 1,
                }}
              />
            </div>
            <span
              className="cinema-mono text-[10.5px] w-9 text-right tabular-nums font-semibold"
              style={{ color: it.score == null ? 'var(--cinema-text-3)' : color }}
            >
              {it.score == null ? '—' : it.score}
            </span>
            {it.retried && (
              <span className="cinema-mono text-[8.5px] opacity-50 tracking-widest" title="本镜触发过自动重生">
                RTY
              </span>
            )}
            {isLow && !it.retried && (
              <span className="cinema-mono text-[8.5px] tracking-widest" style={{ color: 'var(--cinema-red)' }}>
                LOW
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────
// CameoDonut — 三段式环形
// ────────────────────────────────────────────────
export function CameoDonut({
  pass,
  warn,
  fail,
  na = 0,
  centerLabel,
  centerSub,
  size = 96,
}: {
  pass: number;
  warn: number;
  fail: number;
  na?: number;
  centerLabel: ReactNode;
  centerSub?: string;
  size?: number;
}) {
  const total = pass + warn + fail + na;
  const r = (size - 8) / 2; // padding 4px
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  // 计算每段的 stroke-dasharray
  const segments: Array<{ value: number; color: string; key: string }> = [];
  if (pass > 0) segments.push({ value: pass, color: TIER_COLOR.pass, key: 'pass' });
  if (warn > 0) segments.push({ value: warn, color: TIER_COLOR.warn, key: 'warn' });
  if (fail > 0) segments.push({ value: fail, color: TIER_COLOR.fail, key: 'fail' });
  if (na > 0) segments.push({ value: na, color: TIER_COLOR.na, key: 'na' });

  let acc = 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* 底环 */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="var(--cinema-surface-2)"
          strokeWidth="6"
        />
        {total > 0 && segments.map((seg) => {
          const len = (seg.value / total) * circ;
          const offset = (acc / total) * circ;
          acc += seg.value;
          return (
            <circle
              key={seg.key}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="6"
              strokeDasharray={`${len} ${circ}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              className="transition-[stroke-dasharray] duration-700 ease-out"
            />
          );
        })}
      </svg>
      {/* 中心读数 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="cinema-mono text-[20px] font-semibold tabular-nums leading-none">
          {centerLabel}
        </span>
        {centerSub && (
          <span className="cinema-mono text-[8.5px] tracking-widest opacity-50 mt-1">
            {centerSub}
          </span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Sparkline — 紧凑趋势线 (v2.13.4: 渐变面积 + 端点 + auto-trend 配色)
//
// 用于 PolishHistoryPanel 顶部 — 一眼看 AIGC 就绪度是否在变好
// ────────────────────────────────────────────────
export function Sparkline({
  values,
  width = 80,
  height = 20,
  color,
  area = true,
  endpoints = true,
  domain,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** 默认按 trend 自动:首末值上升=green / 持平=amber / 下降=red */
  color?: string;
  /** 是否在线下加渐变面积填充 */
  area?: boolean;
  /** 是否在首末点画小圆点 */
  endpoints?: boolean;
  /** 强制 [min, max] 域 (默认按数据自动); 比如分数总是用 [0, 100] */
  domain?: [number, number];
}) {
  if (values.length < 2) return null;

  // auto-trend: 首末比较, 决定线色
  const first = values[0];
  const last = values[values.length - 1];
  const trendColor = color
    ? color
    : last > first
      ? 'var(--cinema-green)'
      : last < first
        ? 'var(--cinema-red)'
        : 'var(--cinema-amber)';

  const [domMin, domMax] = domain ?? [Math.min(...values), Math.max(...values)];
  const range = domMax - domMin || 1;
  const step = width / (values.length - 1);

  const coords = values.map((v, i) => ({
    x: i * step,
    y: height - ((v - domMin) / range) * (height - 2) - 1, // 1px padding 上下
  }));

  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPath = `M ${coords[0].x},${height} L ${linePoints
    .split(' ')
    .join(' L ')} L ${coords[coords.length - 1].x},${height} Z`;

  const gradId = `cinema-spark-grad-${trendColor.replace(/[^a-z]/gi, '')}`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      {area && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={trendColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
        </>
      )}
      <polyline
        points={linePoints}
        fill="none"
        stroke={trendColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {endpoints && (
        <>
          <circle cx={coords[0].x} cy={coords[0].y} r="1.8" fill={trendColor} opacity="0.6" />
          <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="2.4" fill={trendColor} />
        </>
      )}
    </svg>
  );
}

// ────────────────────────────────────────────────
// ScoreDonut — 项目卡专用 mini donut (v2.13.4)
//
// 单弧, 颜色按 tier (≥85 绿 / ≥70 琥珀 / <70 红 / N/A 灰), 中心显示分数。
// 设计为 28-44px 范围, 替代项目卡上原本的"分数小药丸"。
// ────────────────────────────────────────────────
export function ScoreDonut({
  score,
  size = 36,
  thickness = 3.5,
  showCenter = true,
  centerLabel,
}: {
  score: number | null | undefined;
  /** 直径 px */
  size?: number;
  /** 描边粗细 px */
  thickness?: number;
  /** 是否在中央渲染分数 */
  showCenter?: boolean;
  /** 自定义中心文字 (默认 = score 取整) */
  centerLabel?: ReactNode;
}) {
  const t = tier(score);
  const color = TIER_COLOR[t];
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const filled = typeof score === 'number' ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const dash = filled * circ;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-label={typeof score === 'number' ? `Score ${score}` : 'No score'}
      role="img"
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--cinema-surface-2)"
          strokeWidth={thickness}
          opacity="0.6"
        />
        {typeof score === 'number' && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-700 ease-out"
          />
        )}
      </svg>
      {showCenter && (
        <span
          className="absolute inset-0 flex items-center justify-center cinema-mono font-semibold tabular-nums"
          style={{
            fontSize: Math.max(9, Math.round(size * 0.32)),
            color: typeof score === 'number' ? color : 'var(--cinema-text-3)',
            lineHeight: 1,
          }}
        >
          {centerLabel ?? (typeof score === 'number' ? Math.round(score) : '—')}
        </span>
      )}
    </div>
  );
}
