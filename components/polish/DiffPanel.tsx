'use client';

/**
 * DiffPanel — 原文 vs 润色后 并排对比视图。
 *
 * 为什么独立成组件:
 *   润色页本身已经很长, 把 diff 渲染 + 小状态栏抽出来便于复用
 *   (以后项目详情页想展示"上次润色改了啥"也能直接嵌)。
 *
 * 渲染逻辑:
 *   - same   → 两列都是同一行, 淡灰
 *   - mod    → 左红底(原) + 右绿底(新), 同一视觉行
 *   - del    → 只左, 右占位空白
 *   - add    → 只右, 左占位空白
 *
 * 视觉上用 CSS grid-cols-2 让左右永远对齐, 单元格上染色 + 左侧小色条
 * (借鉴 GitHub/GitLab 的 diff 面板风格)。
 */

import { useMemo } from 'react';
import { diffLines, diffStats, type DiffRow } from '@/lib/text-diff';

export default function DiffPanel({
  before, after, maxHeight = '60vh',
}: {
  before: string;
  after: string;
  maxHeight?: string;
}) {
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  const stats = useMemo(() => diffStats(rows), [rows]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-black/25 overflow-hidden">
      {/* 状态栏: 改动统计 */}
      <div className="px-3 py-2 bg-black/30 border-b border-[var(--border)] flex items-center gap-3 text-[11px] flex-wrap">
        <span className="text-white/45 tracking-wider uppercase">Diff</span>
        <span className="text-emerald-300 font-mono tabular-nums">+ {stats.add + stats.mod}</span>
        <span className="text-rose-300 font-mono tabular-nums">− {stats.del + stats.mod}</span>
        <span className="text-white/45 font-mono tabular-nums">= {stats.same}</span>
        <span className="ml-auto text-white/40">
          改动率 <span className="font-mono text-white/70">{Math.round(stats.changeRatio * 100)}%</span>
          {' · '}
          共 <span className="font-mono text-white/70">{stats.total}</span> 行
        </span>
      </div>

      {/* Diff 主体 */}
      <div
        className="overflow-auto font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[12.5px] leading-relaxed"
        style={{ maxHeight }}
      >
        <div className="grid grid-cols-[1fr_1fr] min-w-full">
          {/* 顶部表头(sticky) */}
          <div className="sticky top-0 z-10 px-3 py-1.5 bg-black/50 backdrop-blur border-b border-white/10 text-[10px] tracking-widest uppercase text-white/45">
            原文
          </div>
          <div className="sticky top-0 z-10 px-3 py-1.5 bg-black/50 backdrop-blur border-b border-white/10 border-l border-l-white/10 text-[10px] tracking-widest uppercase text-white/45">
            润色后
          </div>

          {rows.map((r, idx) => (
            <DiffRowView key={idx} row={r} />
          ))}

          {rows.length === 0 ? (
            <div className="col-span-2 p-6 text-center text-white/40 text-[12px]">
              两段内容完全一致 — 无差异可显示
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DiffRowView({ row }: { row: DiffRow }) {
  // 颜色方案, 参考 GitHub diff:
  //   same → 中性灰
  //   del  → 左红 (#f85149-ish), 右空
  //   add  → 左空, 右绿 (#3fb950-ish)
  //   mod  → 左红 + 右绿, 视觉上同一行
  if (row.kind === 'same') {
    return (
      <>
        <LineCell tone="neutral" text={row.text} />
        <LineCell tone="neutral" text={row.text} borderLeft />
      </>
    );
  }
  if (row.kind === 'del') {
    return (
      <>
        <LineCell tone="del" text={row.text} sign="−" />
        <LineCell tone="empty" text="" borderLeft />
      </>
    );
  }
  if (row.kind === 'add') {
    return (
      <>
        <LineCell tone="empty" text="" />
        <LineCell tone="add" text={row.text} sign="+" borderLeft />
      </>
    );
  }
  // mod
  return (
    <>
      <LineCell tone="del" text={row.left} sign="−" />
      <LineCell tone="add" text={row.right} sign="+" borderLeft />
    </>
  );
}

function LineCell({
  tone, text, sign, borderLeft,
}: {
  tone: 'neutral' | 'del' | 'add' | 'empty';
  text: string;
  sign?: '+' | '−';
  borderLeft?: boolean;
}) {
  const base = 'px-3 py-1 whitespace-pre-wrap break-words';
  const toneClass =
    tone === 'del'
      ? 'bg-rose-500/10 text-rose-100 border-l-2 border-l-rose-400/60'
      : tone === 'add'
        ? 'bg-emerald-500/10 text-emerald-100 border-l-2 border-l-emerald-400/60'
        : tone === 'empty'
          ? 'bg-white/[0.02] text-white/25'
          : 'text-white/75';
  const vertDivider = borderLeft ? 'border-l border-l-white/5' : '';
  return (
    <div className={`${base} ${toneClass} ${vertDivider}`}>
      {sign ? (
        <span className={`inline-block w-3 mr-1 font-bold opacity-70 select-none ${
          sign === '+' ? 'text-emerald-300' : 'text-rose-300'
        }`}>{sign}</span>
      ) : tone === 'neutral' ? (
        <span className="inline-block w-3 mr-1 opacity-30 select-none">·</span>
      ) : (
        <span className="inline-block w-3 mr-1 select-none">{' '}</span>
      )}
      {text || (tone === 'empty' ? '\u00A0' : '')}
    </div>
  );
}
