'use client';

/**
 * ModeCard (v2.0 Sprint 0 D5)
 *
 * 5 种创作模式的卡片选择器。对齐 OiiOii 的创作入口设计，但保留
 * 我方原创模式（本期决议：暂时不砍任何模式）。
 *
 * 5 modes:
 *   1. episodic      连续剧集  —— 多集连续叙事，角色/风格强一致
 *   2. mv            MV / 歌词  —— 音乐驱动，节拍对齐
 *   3. quick         速创 60s  —— 一键出片，适合抖音短视频
 *   4. comic-to-video 漫画转动画 —— 上传分镜/漫画直接转视频
 *   5. ip-derivative IP 衍生    —— 基于已有角色/IP 二创
 *
 * 每卡片包含：图标、中英文名、特色说明、预计用时、按钮。
 *
 * 使用：
 *   <ModeCardGrid value={mode} onChange={setMode} />
 *   <ModeCard preset={MODE_PRESETS.mv} selected onSelect={...} />
 */

import * as React from 'react';
import type { CreationMode } from '@/types/agents';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// 预设配置
// ──────────────────────────────────────────────────────────

export interface ModePreset {
  mode: CreationMode;
  icon: string;
  name: string;
  nameEn: string;
  desc: string;
  features: string[];
  estMinutes: string;
  gradient: string;
  recommendedFor?: string;
}

export const MODE_PRESETS: Record<CreationMode, ModePreset> = {
  episodic: {
    mode: 'episodic',
    icon: '🎬',
    name: '连续剧集',
    nameEn: 'Episodic Series',
    desc: '多集连续叙事，角色与世界观强一致',
    features: ['跨集角色一致', '世界观锁定', '3-20 集批量'],
    estMinutes: '每集 12-20 分钟',
    gradient: 'from-purple-500/20 to-indigo-500/20',
    recommendedFor: '番剧 / 连载短剧',
  },
  mv: {
    mode: 'mv',
    icon: '🎵',
    name: 'MV 音乐视频',
    nameEn: 'Music Video',
    desc: '音乐节拍驱动，歌词与画面精准对齐',
    features: ['歌词分段上屏', '节拍同步切镜', '情绪匹配配色'],
    estMinutes: '3-5 分钟出片',
    gradient: 'from-pink-500/20 to-rose-500/20',
    recommendedFor: '原创 MV / 二创饭制',
  },
  quick: {
    mode: 'quick',
    icon: '⚡',
    name: '速创 60s',
    nameEn: 'Quick 60s',
    desc: '一句话直出 60 秒短视频，抖音快手风格',
    features: ['一键生成', '自动封面', '竖屏 9:16'],
    estMinutes: '3-8 分钟出片',
    gradient: 'from-orange-500/20 to-amber-500/20',
    recommendedFor: '日更短视频 / 热点跟拍',
  },
  'comic-to-video': {
    mode: 'comic-to-video',
    icon: '📖',
    name: '漫画转动画',
    nameEn: 'Comic → Video',
    desc: '上传静态漫画/分镜，转换为动态视频',
    features: ['OCR 识别气泡', '镜头运动生成', '配音自动匹配'],
    estMinutes: '10-25 分钟',
    gradient: 'from-teal-500/20 to-cyan-500/20',
    recommendedFor: '漫画动态化 / 绘本改编',
  },
  'ip-derivative': {
    mode: 'ip-derivative',
    icon: '✨',
    name: 'IP 衍生创作',
    nameEn: 'IP Derivative',
    desc: '基于已有角色/IP 进行二次创作',
    features: ['角色记忆复用', '风格锁定', '多场景批产'],
    estMinutes: '8-15 分钟',
    gradient: 'from-violet-500/20 to-fuchsia-500/20',
    recommendedFor: '粉丝二创 / IP 拓展',
  },
};

export const ALL_MODES: CreationMode[] = [
  'episodic',
  'mv',
  'quick',
  'comic-to-video',
  'ip-derivative',
];

// ──────────────────────────────────────────────────────────
// Single ModeCard
// ──────────────────────────────────────────────────────────

export interface ModeCardProps {
  preset: ModePreset;
  selected?: boolean;
  onSelect?: (mode: CreationMode) => void;
  className?: string;
}

export function ModeCard({ preset, selected, onSelect, className }: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(preset.mode)}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all duration-300',
        'bg-gradient-to-br p-5',
        preset.gradient,
        selected
          ? 'border-[#E8C547] shadow-lg shadow-[#E8C547]/20'
          : 'border-white/10 hover:border-white/40 hover:shadow-lg',
        className,
      )}
      data-testid={`mode-card-${preset.mode}`}
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
    >
      {/* 选中勾 */}
      {selected && (
        <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#E8C547] text-black">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-8 8a1 1 0 01-1.42 0l-4-4a1 1 0 011.42-1.42L8 12.58l7.29-7.29a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}

      {/* 图标 + 标题 */}
      <div className="mb-3 flex items-center gap-3">
        <div className="text-4xl">{preset.icon}</div>
        <div>
          <div className="text-lg font-bold text-white">{preset.name}</div>
          <div className="text-[11px] text-neutral-300 opacity-80">{preset.nameEn}</div>
        </div>
      </div>

      {/* 描述 */}
      <p className="mb-3 text-xs text-neutral-200/90 line-clamp-2">{preset.desc}</p>

      {/* 特性列表 */}
      <ul className="mb-3 space-y-1">
        {preset.features.map(f => (
          <li key={f} className="flex items-center gap-1.5 text-[11px] text-neutral-200/80">
            <span className="text-[#E8C547]">◆</span>
            {f}
          </li>
        ))}
      </ul>

      {/* 底部元信息 */}
      <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-2 text-[10px]">
        <span className="text-neutral-300">⏱ {preset.estMinutes}</span>
        {preset.recommendedFor && (
          <span className="text-neutral-400">{preset.recommendedFor}</span>
        )}
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Grid wrapper
// ──────────────────────────────────────────────────────────

export interface ModeCardGridProps {
  value?: CreationMode;
  onChange?: (mode: CreationMode) => void;
  className?: string;
}

export function ModeCardGrid({ value, onChange, className }: ModeCardGridProps) {
  return (
    <div
      className={cn(
        'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
        className,
      )}
      data-testid="mode-grid"
    >
      {ALL_MODES.map(m => (
        <ModeCard
          key={m}
          preset={MODE_PRESETS[m]}
          selected={value === m}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}
