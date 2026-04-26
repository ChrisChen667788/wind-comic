'use client';

/**
 * ResolutionSelector (v2.0 Sprint 0 D5)
 *
 * 分辨率档位选择器 —— 360P / 480P / 720P (本期最高 720P)。
 *
 * 功能：
 *  - 三档可视化卡片（尺寸示意 + 价格预估）
 *  - 可选时长联动计算本次生成的成本
 *  - 显示 aspect ratio 切换（16:9 / 9:16 / 1:1）
 *  - 不含 4K (本期决议)
 *
 * 使用：
 *   <ResolutionSelector
 *     value={{ resolution: '720p', aspectRatio: '16:9' }}
 *     durationSec={5}
 *     onChange={...}
 *   />
 */

import * as React from 'react';
import type { ResolutionTier, AspectRatio } from '@/types/agents';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// 成本表（单位 ¥/秒，估算；后端 cost_log 会写真实值）
// ──────────────────────────────────────────────────────────

interface TierMeta {
  label: string;
  dim: string;
  pricePerSec: number;
  desc: string;
  badge?: string;
}

const TIER_META: Record<ResolutionTier, TierMeta> = {
  '360p': {
    label: '360P',
    dim: '640 × 360',
    pricePerSec: 0.05,
    desc: '草稿档，快速验证分镜',
  },
  '480p': {
    label: '480P',
    dim: '854 × 480',
    pricePerSec: 0.12,
    desc: '标准档，社交分发可用',
    badge: '推荐',
  },
  '720p': {
    label: '720P',
    dim: '1280 × 720',
    pricePerSec: 0.22,
    desc: '高清档，适合成片',
  },
};

const ASPECT_RATIOS: Array<{ value: AspectRatio; label: string; icon: string }> = [
  { value: '16:9', label: '横屏 16:9', icon: '▭' },
  { value: '9:16', label: '竖屏 9:16', icon: '▯' },
  { value: '1:1', label: '方形 1:1', icon: '◻' },
];

// ──────────────────────────────────────────────────────────
// Helpers (exported for tests)
// ──────────────────────────────────────────────────────────

export function estimateCost(resolution: ResolutionTier, durationSec: number): number {
  const meta = TIER_META[resolution];
  if (!meta) return 0;
  return Math.round(meta.pricePerSec * durationSec * 100) / 100;
}

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────

export interface ResolutionSelectorValue {
  resolution: ResolutionTier;
  aspectRatio: AspectRatio;
}

export interface ResolutionSelectorProps {
  value: ResolutionSelectorValue;
  onChange: (next: ResolutionSelectorValue) => void;
  /** 用于计算本次成本预估的时长（秒） */
  durationSec?: number;
  /** 是否禁用 aspect ratio 切换（某些模式强制固定比例） */
  lockAspectRatio?: boolean;
  className?: string;
}

export function ResolutionSelector({
  value,
  onChange,
  durationSec = 5,
  lockAspectRatio = false,
  className,
}: ResolutionSelectorProps) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {/* 分辨率卡片 */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-sm font-semibold text-white">分辨率</h4>
          <span className="text-xs text-neutral-400">
            本期最高 720P · 4K 敬请期待
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="resolution-grid">
          {(Object.keys(TIER_META) as ResolutionTier[]).map(tier => {
            const meta = TIER_META[tier];
            const selected = value.resolution === tier;
            const cost = estimateCost(tier, durationSec);
            return (
              <button
                key={tier}
                type="button"
                onClick={() => onChange({ ...value, resolution: tier })}
                className={cn(
                  'relative rounded-lg border-2 p-4 text-left transition-all duration-200',
                  selected
                    ? 'border-[#E8C547] bg-[#E8C547]/10 shadow-lg shadow-[#E8C547]/10'
                    : 'border-white/10 bg-white/5 hover:border-white/30',
                )}
                data-testid={`resolution-tier-${tier}`}
                data-selected={selected}
                aria-pressed={selected}
              >
                {meta.badge && (
                  <span className="absolute right-2 top-2 rounded bg-[#E8C547]/30 px-1.5 py-0.5 text-[10px] font-bold text-[#E8C547]">
                    {meta.badge}
                  </span>
                )}
                <div className="text-lg font-bold text-white">{meta.label}</div>
                <div className="mt-1 text-xs text-neutral-400">{meta.dim}</div>
                <div className="mt-3 text-[11px] text-neutral-300">{meta.desc}</div>
                <div className="mt-3 flex items-baseline gap-1 border-t border-white/10 pt-2">
                  <span className="text-xs text-neutral-400">预估</span>
                  <span className="text-sm font-semibold text-[#E8C547]">
                    ¥{cost.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-neutral-500">/ {durationSec}s</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Aspect Ratio */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-sm font-semibold text-white">画面比例</h4>
          {lockAspectRatio && (
            <span className="text-[11px] text-neutral-500">此模式强制固定比例</span>
          )}
        </div>
        <div className="flex gap-2" data-testid="aspect-ratio-row">
          {ASPECT_RATIOS.map(ar => {
            const selected = value.aspectRatio === ar.value;
            return (
              <button
                key={ar.value}
                type="button"
                disabled={lockAspectRatio}
                onClick={() => onChange({ ...value, aspectRatio: ar.value })}
                className={cn(
                  'flex-1 rounded-lg border-2 px-3 py-3 text-sm transition-all',
                  selected
                    ? 'border-[#E8C547] bg-[#E8C547]/10 text-white'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:border-white/30',
                  lockAspectRatio && 'cursor-not-allowed opacity-40',
                )}
                data-testid={`aspect-${ar.value}`}
                data-selected={selected}
                aria-pressed={selected}
              >
                <div className="text-2xl leading-none">{ar.icon}</div>
                <div className="mt-1 text-xs">{ar.label}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
