'use client';

/**
 * components/project/emotion-rhythm-chart (v7.5) — 情感曲线 + 多轨节奏热力图
 * (对标 CineMatrix Emotion Curve / CineFlow 节奏热力图)
 *
 * 4 条随镜推进的曲线: 情感强度 / 紧张感 / 节奏 / 亮度 (0-100), 叠加高潮镜竖线 + 图例 + 摘要。
 * 纯展示, 输入 EmotionPoint[] (由 lib/emotion-curve 计算)。
 */

import { useState } from 'react';
import { Pulse as Activity } from '@phosphor-icons/react';
import { EmptyState } from '@/components/cinema/primitives';
import { curveStats, describeCurve, type EmotionPoint } from '@/lib/emotion-curve';

const SERIES: { key: keyof EmotionPoint; label: string; color: string }[] = [
  { key: 'emotion', label: '情感强度', color: '#E8C547' },
  { key: 'tension', label: '紧张感', color: '#C8432A' },
  { key: 'rhythm', label: '节奏', color: '#5A8FCC' },
  { key: 'brightness', label: '亮度', color: '#22D3A5' },
];

const W = 100, H = 42, PAD = 2;

function linePath(curve: EmotionPoint[], key: keyof EmotionPoint): string {
  const n = curve.length;
  if (n === 0) return '';
  return curve
    .map((p, i) => {
      const x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
      const y = H - PAD - ((p[key] as number) / 100) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function EmotionRhythmChart({ curve }: { curve: EmotionPoint[] }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const stats = curveStats(curve);

  if (!curve.length) {
    return <div className="cinema-card"><EmptyState icon={Activity} title="暂无分镜情绪数据" hint="先生成剧本 / 分镜" /></div>;
  }

  const climaxX = stats.climaxIndex >= 0 && curve.length > 1
    ? PAD + (stats.climaxIndex / (curve.length - 1)) * (W - PAD * 2)
    : null;

  return (
    <div className="cinema-card !p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="cinema-eyebrow flex items-center gap-1.5"><Activity size={13} className="text-[var(--primary)]" /> 情感曲线 · 节奏热力图</span>
        <span className="cinema-mono text-[10px] opacity-60">{describeCurve(curve)}</span>
      </div>

      {/* 图例 (可点切换显隐) */}
      <div className="flex flex-wrap gap-2 mb-2">
        {SERIES.map((s) => (
          <button key={s.key} onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
            className={`flex items-center gap-1 cinema-mono text-[10px] transition ${hidden[s.key] ? 'opacity-30' : 'opacity-90'}`}>
            <span className="w-3 h-[2px] rounded" style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>

      {/* 曲线 */}
      <div className="relative w-full" style={{ aspectRatio: '100 / 42' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
          {/* 网格基线 */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={PAD} x2={W - PAD} y1={H - PAD - g * (H - PAD * 2)} y2={H - PAD - g * (H - PAD * 2)}
              stroke="var(--border)" strokeWidth="0.2" />
          ))}
          {/* 高潮镜竖线 */}
          {climaxX != null && (
            <line x1={climaxX} x2={climaxX} y1={PAD} y2={H - PAD} stroke="var(--primary)" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.6" />
          )}
          {/* 4 轨 */}
          {SERIES.filter((s) => !hidden[s.key]).map((s) => (
            <path key={s.key} d={linePath(curve, s.key)} fill="none" stroke={s.color} strokeWidth="0.7" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>

      {/* X 轴镜号 + 高潮标 */}
      <div className="flex justify-between cinema-mono text-[9px] opacity-50 mt-1">
        <span>镜 1</span>
        {stats.climaxIndex >= 0 && <span className="text-[var(--primary)]">▲ 高潮 第 {stats.climaxIndex + 1} 镜</span>}
        <span>镜 {curve.length}</span>
      </div>
    </div>
  );
}
