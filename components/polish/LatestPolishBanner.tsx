'use client';

/**
 * LatestPolishBanner — 项目详情页顶部"最近一次润色体检"横幅。
 *
 * 消费的是 polish page 回写到 script asset.data.latestPolish 里的那条记录,
 * 形成闭环:
 *   润色 → 回写 → 项目页看到就绪度 → 决定是否重跑
 *
 * 默认状态: 折叠, 只显示 AIGC 就绪度 + 摘要 + 改动点数量。
 * 点"展开体检单"会嵌入完整的 IndustryAuditCard。
 *
 * 如果 latestPolish 不存在或结构不对, 组件自动不渲染, 不污染页面。
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Stethoscope, ChevronDown, ChevronUp, Activity, Clock, Sparkles, ExternalLink,
} from 'lucide-react';
import IndustryAuditCard, { type PolishAudit } from './IndustryAuditCard';
import { readinessLevel } from '@/lib/polish-prompts';

interface LatestPolishEntry {
  at?: string;
  mode?: 'basic' | 'pro';
  style?: string | null;
  intensity?: string;
  focus?: string | null;
  polished?: string;
  summary?: string;
  notes?: string[];
  audit?: PolishAudit | null;
  model?: string;
}

export default function LatestPolishBanner({
  entry, projectId,
}: {
  entry: LatestPolishEntry | null | undefined;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Hook 在 early return 前先跑完 (React hooks 规则),
  // entry 不存在时 useMemo 拿 undefined 也没问题
  const when = useMemo(() => {
    if (!entry?.at) return '';
    try {
      const d = new Date(entry.at);
      const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
      if (diffMin < 1) return '刚刚';
      if (diffMin < 60) return `${diffMin} 分钟前`;
      if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小时前`;
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }, [entry?.at]);

  // 容错: 没有 polished 就当没跑过, 组件静默消失
  if (!entry || typeof entry.polished !== 'string') return null;

  const score = entry.audit?.aigcReadiness?.score;
  const hasScore = typeof score === 'number';
  const lvl = hasScore ? readinessLevel(score!) : null;

  const barColor =
    lvl?.level === 'green' ? 'bg-emerald-400'
      : lvl?.level === 'amber' ? 'bg-amber-400'
        : 'bg-rose-400';
  const labelColor =
    lvl?.level === 'green' ? 'text-emerald-300'
      : lvl?.level === 'amber' ? 'text-amber-300'
        : 'text-rose-300';

  return (
    <div className="mb-6 rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.08] to-rose-500/[0.05] overflow-hidden">
      {/* 主横幅行 */}
      <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <Stethoscope className="w-5 h-5 text-violet-300" />
          <div>
            <p className="text-[11px] text-violet-300 tracking-widest uppercase leading-none">
              最近一次润色
            </p>
            <p className="text-[10px] text-white/40 mt-1">
              {entry.mode === 'pro' ? 'Pro · 行业级诊断' : 'Basic'}
              {when ? ` · ${when}` : ''}
            </p>
          </div>
        </div>

        {/* 就绪度分数 + 进度条 (仅 Pro) */}
        {hasScore && lvl ? (
          <div className="flex items-center gap-2 min-w-[200px] flex-1">
            <Activity className={`w-4 h-4 ${labelColor}`} />
            <span className={`text-xl font-bold tabular-nums ${labelColor}`}>{score}</span>
            <span className="text-[10px] text-white/40">/ 100</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden ml-2 min-w-[80px]">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
            </div>
            <span className={`text-[11px] ${labelColor}`}>{lvl.label}</span>
          </div>
        ) : null}

        {/* 改动点数 */}
        {Array.isArray(entry.notes) && entry.notes.length > 0 ? (
          <span className="text-[11px] text-white/55 bg-white/5 px-2 py-0.5 rounded-full">
            {entry.notes.length} 处调整
          </span>
        ) : null}

        {/* 动作按钮 */}
        <div className="flex items-center gap-1.5 ml-auto">
          {entry.audit ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[12px] text-white/80 transition-colors flex items-center gap-1"
              title={expanded ? '折叠体检单' : '展开完整体检单'}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? '收起' : '查看体检单'}
            </button>
          ) : null}
          <Link
            href={`/dashboard/polish?projectId=${encodeURIComponent(projectId)}`}
            className="px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-[12px] text-violet-100 border border-violet-500/30 transition-colors flex items-center gap-1"
            title="去 Polish Studio 再润色一次"
          >
            <Sparkles className="w-3.5 h-3.5" />
            再润色
            <ExternalLink className="w-3 h-3 opacity-60" />
          </Link>
        </div>
      </div>

      {/* 摘要条 */}
      {entry.summary ? (
        <div className="px-5 pb-3 -mt-1 text-[12.5px] text-white/75 leading-relaxed flex gap-2">
          <Clock className="w-3.5 h-3.5 text-white/35 shrink-0 mt-0.5" />
          <span>{entry.summary}</span>
        </div>
      ) : null}

      {/* 展开区: 完整 audit */}
      {expanded && entry.audit ? (
        <div className="px-5 pb-5 pt-2 border-t border-white/5 bg-black/15">
          <IndustryAuditCard audit={entry.audit} />
        </div>
      ) : null}
    </div>
  );
}
