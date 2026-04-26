'use client';

/**
 * CameoScoreBadge (v2.11 #2)
 *
 * 展示 /api/cameo/preview 返回的评分 —— 一个卡片化的"图片适配度报告"。
 *
 * 设计:
 *   - 顶部大数字 + verdict 徽章(excellent/good/fair/poor 配色)
 *   - 4 个维度 mini-bar (清晰度/光线/角度/尺寸)
 *   - 警告红条 / 建议灰条
 *   - loading / error 两态
 *
 * 复用点:CameoPanel(项目详情) + CreatePage(创作中上传)都可挂载。
 */

import { Loader2, AlertTriangle, Lightbulb, Sparkles } from 'lucide-react';

export interface CameoScoreBadgeData {
  score: number;
  verdict: 'excellent' | 'good' | 'fair' | 'poor';
  dimensions: {
    clarity: number;
    lighting: number;
    angle: number;
    size: number;
  };
  suggestions: string[];
  warnings: string[];
  summary?: string;
}

interface Props {
  loading?: boolean;
  error?: string | null;
  data?: CameoScoreBadgeData | null;
  /** 紧凑模式,减掉 summary,用在窄栏 */
  compact?: boolean;
}

const VERDICT_META: Record<
  CameoScoreBadgeData['verdict'],
  { label: string; color: string; bg: string }
> = {
  excellent: { label: '非常适合', color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  good:      { label: '适合',     color: 'text-[#E8C547]',   bg: 'bg-[#E8C547]/15 border-[#E8C547]/30' },
  fair:      { label: '勉强可用', color: 'text-orange-300',  bg: 'bg-orange-500/15 border-orange-500/30' },
  poor:      { label: '不建议',   color: 'text-red-300',     bg: 'bg-red-500/15 border-red-500/30' },
};

export function CameoScoreBadge({ loading, error, data, compact = false }: Props) {
  if (loading) {
    return (
      <div className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        正在分析这张脸的适配度…
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-gray-500">
        评分暂不可用({error}),不影响锁脸。
      </div>
    );
  }
  if (!data) return null;

  const v = VERDICT_META[data.verdict];

  return (
    <div className={`mt-3 p-3 rounded-xl border ${v.bg} space-y-2`}>
      {/* 顶部:大分数 + verdict */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${v.color}`} />
          <span className="text-xs text-gray-300">Cameo 适配度</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xl font-bold ${v.color} leading-none`}>{data.score}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${v.bg} ${v.color}`}>
            {v.label}
          </span>
        </div>
      </div>

      {/* 四维 mini-bar */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <DimBar label="清晰度" value={data.dimensions.clarity} />
        <DimBar label="光线"   value={data.dimensions.lighting} />
        <DimBar label="角度"   value={data.dimensions.angle} />
        <DimBar label="尺寸"   value={data.dimensions.size} />
      </div>

      {/* 警告(红) */}
      {data.warnings.length > 0 && (
        <ul className="space-y-1">
          {data.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-red-300">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 建议(灰) */}
      {data.suggestions.length > 0 && (
        <ul className="space-y-1">
          {data.suggestions.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-400">
              <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0 text-[#E8C547]/70" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {/* summary(可选) */}
      {!compact && data.summary && (
        <p className="text-[11px] text-gray-500 italic border-t border-white/5 pt-2">
          {data.summary}
        </p>
      )}
    </div>
  );
}

function DimBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80 ? 'from-emerald-400 to-emerald-500'
    : value >= 60 ? 'from-[#E8C547] to-[#D4A830]'
    : value >= 40 ? 'from-orange-400 to-orange-500'
    : 'from-red-400 to-red-500';
  return (
    <div>
      <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${color} transition-all duration-500`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
