'use client';

/**
 * PolishHistoryPanel — 历史润色记录浏览 / 恢复 modal
 *
 * 消费的是 scriptAsset.data.polishHistory[] (由 polish page 的 handleSaveToProject 写入, 最多 10 条)。
 *
 * 两种动作:
 *   · "查看"  → emit onView(entry), 父组件把 entry 填到当前 result 位置, 关闭 modal
 *   · "替换原文" → emit onRestoreSource(entry), 父组件把 entry.polished 填到左侧原文 textarea,
 *                  方便"从某个旧版基础上再润"(迭代工作流)
 *
 * 为什么要独立成 modal 而不是嵌在 polish page 里:
 *   polish page 已经 770+ 行, 再塞下去会失控; 并且 10 条列表需要自己的滚动容器和阴影,
 *   modal 容器更干净, 也便于将来在项目详情页复用("这个项目的润色史")。
 */

import { useMemo } from 'react';
import {
  X, History, Stethoscope, Gauge, ArrowRightLeft, Eye, Activity, FileText,
} from 'lucide-react';
import type { PolishAudit } from './IndustryAuditCard';
import { readinessLevel } from '@/lib/polish-prompts';

export interface PolishHistoryEntry {
  at?: string;
  mode?: 'basic' | 'pro';
  style?: string | null;
  intensity?: string;
  focus?: string | null;
  polished?: string;
  summary?: string;
  notes?: string[];
  audit?: PolishAudit | null;
  elapsedMs?: number;
  model?: string;
}

export default function PolishHistoryPanel({
  history,
  onClose,
  onView,
  onRestoreSource,
}: {
  history: PolishHistoryEntry[];
  onClose: () => void;
  onView: (entry: PolishHistoryEntry) => void;
  onRestoreSource: (entry: PolishHistoryEntry) => void;
}) {
  // 按时间倒序已经是入库的顺序 (handleSaveToProject 倒序 slice), 这里不再排序
  // 但为了防止有人手工改动 asset 数据导致顺序错乱, 再做一次稳定排序
  const sorted = useMemo(() => {
    return [...history].sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });
  }, [history]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="px-5 py-3.5 border-b border-[var(--border)] bg-black/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-violet-300" />
            <h3 className="text-sm font-semibold text-white">
              润色历史 · 最近 {sorted.length} 次
            </h3>
            <span className="text-[10px] text-white/40">· 最多保留 10 条</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/50 flex flex-col items-center gap-3">
              <FileText className="w-8 h-8 text-white/20" />
              <p>还没有历史记录</p>
              <p className="text-[11px] text-white/35 max-w-[280px]">
                跑完润色后点"回写项目",这里就会出现可回看/恢复的版本。
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {sorted.map((e, i) => (
                <HistoryRow
                  key={e.at ? `${e.at}-${i}` : i}
                  entry={e}
                  index={i}
                  onView={() => { onView(e); onClose(); }}
                  onRestoreSource={() => { onRestoreSource(e); onClose(); }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* footer hint */}
        <div className="px-5 py-2.5 border-t border-[var(--border)] bg-black/20 text-[10.5px] text-white/45 leading-relaxed">
          <strong className="text-white/60">查看</strong> 把这次润色填回右侧结果区 ·{' '}
          <strong className="text-white/60">替换原文</strong> 把这次的润色结果作为新的原文,从它迭代
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  entry, index, onView, onRestoreSource,
}: {
  entry: PolishHistoryEntry;
  index: number;
  onView: () => void;
  onRestoreSource: () => void;
}) {
  const when = useMemo(() => {
    if (!entry.at) return '—';
    try {
      const d = new Date(entry.at);
      const diff = Date.now() - d.getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return '刚刚';
      if (m < 60) return `${m} 分钟前`;
      if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前`;
      return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return entry.at;
    }
  }, [entry.at]);

  const score = entry.audit?.aigcReadiness?.score;
  const hasScore = typeof score === 'number';
  const lvl = hasScore ? readinessLevel(score!) : null;
  const scoreColor =
    lvl?.level === 'green' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : lvl?.level === 'amber' ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
        : lvl?.level === 'red' ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
          : '';

  const isPro = entry.mode === 'pro';

  return (
    <li className="rounded-xl border border-[var(--border)] bg-black/25 hover:bg-black/35 transition-colors overflow-hidden">
      <div className="p-3.5 flex flex-col gap-2.5">
        {/* 上: 元数据行 */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-white/40 font-mono tabular-nums">#{index + 1}</span>
          <span
            className={`px-1.5 py-0.5 rounded-md font-semibold text-[10px] border flex items-center gap-1 ${
              isPro
                ? 'bg-violet-500/15 text-violet-200 border-violet-500/30'
                : 'bg-[#E8C547]/10 text-[#E8C547] border-[#E8C547]/25'
            }`}
          >
            {isPro ? <Stethoscope className="w-2.5 h-2.5" /> : <Gauge className="w-2.5 h-2.5" />}
            {isPro ? 'Pro' : 'Basic'}
          </span>
          {entry.style ? (
            <span className="text-white/55">{entry.style}</span>
          ) : null}
          {entry.intensity ? (
            <span className="text-white/40">· {entry.intensity}</span>
          ) : null}
          {hasScore && lvl ? (
            <span className={`ml-auto px-1.5 py-0.5 rounded-md text-[10px] border flex items-center gap-1 tabular-nums ${scoreColor}`}>
              <Activity className="w-2.5 h-2.5" />
              {score} · {lvl.label}
            </span>
          ) : null}
          <span className={hasScore ? 'text-white/40 text-[10px]' : 'ml-auto text-white/40 text-[10px]'}>
            {when}
          </span>
        </div>

        {/* 中: 摘要 */}
        {entry.summary ? (
          <p className="text-[12.5px] text-white/80 leading-relaxed line-clamp-2">
            {entry.summary}
          </p>
        ) : (
          <p className="text-[11.5px] text-white/40 italic">(无摘要)</p>
        )}

        {/* 下: 尺寸 + 动作 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-white/35 tabular-nums">
            {(entry.polished || '').length} 字 · {entry.notes?.length || 0} 调整点
          </span>
          {entry.model ? (
            <span className="text-[10px] text-white/30 font-mono truncate max-w-[160px]" title={entry.model}>
              · {entry.model.slice(0, 22)}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={onView}
              className="px-2 py-1 rounded-md text-[11px] bg-white/5 hover:bg-white/10 text-white/80 border border-white/5 transition-colors flex items-center gap-1"
              title="把这次润色载入到右侧结果区"
            >
              <Eye className="w-3 h-3" />
              查看
            </button>
            <button
              onClick={onRestoreSource}
              className="px-2 py-1 rounded-md text-[11px] bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 border border-violet-500/25 transition-colors flex items-center gap-1"
              title="把这次润色结果作为新的原文 (在此版本上迭代)"
            >
              <ArrowRightLeft className="w-3 h-3" />
              替换原文
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
