'use client';

/**
 * components/project/export-resolution-dropdown (v2.16 P0.2)
 *
 * 项目页右上角的 mp4 导出 dropdown — 让用户挑分辨率下载。
 *   720p  → 免费
 *   1080p → creator+
 *   2160p → pro+
 *
 * 行为:
 *   - 默认选 1080p (主流, 不挡用户)
 *   - 锁档显示锁标 + tooltip; 点了直接跳 /dashboard/billing
 *   - 没锁档点 → 直接 window.open(`/api/.../export?type=mp4&resolution=...`)
 *     浏览器会拿到 attachment header 自动下载
 *
 * 不内置当前用户档位查询 — 让 Plan-gate 在路由层做权威判断,
 * 这里仅把"有可能锁档"的提示渲染出来。
 */

import { useState } from 'react';
import { Download, Lock, CaretDown as ChevronDown } from '@phosphor-icons/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ExportResolution } from '@/lib/plan-gate';

interface ResOption {
  value: ExportResolution;
  label: string;
  desc: string;
  /** 最低 tier 标签, 仅展示用 */
  tierLabel: string;
  /** 是否大概率会被 plan gate 挡 (前端只是提示, 真假最终路由说了算) */
  likelyLocked: boolean;
}

export interface ExportResolutionDropdownProps {
  projectId: string;
  /** 当前用户 tier — 不传就显示所有锁标. 由父组件从 SWR / store 拿 */
  userTier?: 'free' | 'creator' | 'pro' | 'enterprise';
  className?: string;
}

const TIER_RANK: Record<string, number> = {
  free: 0, creator: 1, pro: 2, enterprise: 3,
};

const OPTIONS: Array<Omit<ResOption, 'likelyLocked'>> = [
  { value: '720p',  label: '720p',  desc: 'HD ·  快速 · 任何用户', tierLabel: 'free' },
  { value: '1080p', label: '1080p', desc: 'FHD · 主流 · creator+',  tierLabel: 'creator' },
  { value: '2160p', label: '2160p', desc: '4K UHD · 高清晰 · pro+',  tierLabel: 'pro' },
];

export function ExportResolutionDropdown({
  projectId, userTier, className = '',
}: ExportResolutionDropdownProps) {
  const [open, setOpen] = useState(false);
  const userRank = userTier ? (TIER_RANK[userTier] ?? 0) : -1;

  const optionsWithLock: ResOption[] = OPTIONS.map((o) => ({
    ...o,
    // userRank=-1 (未传 tier) 时 1080p / 2160p 都标"可能锁";
    // 传了 tier 时按规则比对
    likelyLocked:
      userRank < 0
        ? o.tierLabel !== 'free'
        : userRank < (TIER_RANK[o.tierLabel] ?? 0),
  }));

  const handlePick = (opt: ResOption) => {
    if (opt.likelyLocked) {
      // 提示并跳计费页 — 不去硬触发 download (route 也会 402, 但前端先 short-circuit 体验更好)
      window.location.href = '/dashboard/billing';
      return;
    }
    const url = `/api/projects/${encodeURIComponent(projectId)}/export?type=mp4&resolution=${opt.value}`;
    window.open(url, '_blank');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 ${className}`}
          title="下载成片 — 选分辨率"
        >
          <Download className="w-3.5 h-3.5" />
          导出 mp4
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="cinema-mono text-[10px] opacity-50 tracking-widest mb-2 px-1">
          EXPORT RESOLUTION
        </div>
        <div className="space-y-1">
          {optionsWithLock.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handlePick(opt)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-2 rounded-md transition-colors text-left ${
                opt.likelyLocked
                  ? 'opacity-50 hover:bg-[var(--cinema-amber-glow)] hover:opacity-90'
                  : 'hover:bg-[var(--cinema-surface-hi)]'
              }`}
              title={opt.likelyLocked ? `升级到 ${opt.tierLabel} 解锁` : `下载 ${opt.label}`}
            >
              <div className="flex flex-col">
                <span className="cinema-mono text-[12px] font-semibold text-[var(--cinema-text)]">
                  {opt.label}
                </span>
                <span className="text-[10px] text-[var(--cinema-text-3)]">{opt.desc}</span>
              </div>
              {opt.likelyLocked ? (
                <Lock className="w-3.5 h-3.5 text-[var(--cinema-amber)]" />
              ) : (
                <Download className="w-3.5 h-3.5 opacity-60" />
              )}
            </button>
          ))}
        </div>
        <div className="cinema-mono text-[9px] opacity-40 mt-2 px-1 tracking-wide">
          锁标项 → 跳转账户升级页
        </div>
      </PopoverContent>
    </Popover>
  );
}
