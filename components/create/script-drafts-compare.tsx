'use client';

/**
 * components/create/script-drafts-compare (v2.15 G9)
 *
 * 1-3 列剧本草稿对比卡 + "采用此版" 按钮。
 * 数据源: POST /api/script-drafts
 *
 * 用法:
 *   <ScriptDraftsCompare
 *     idea={idea}
 *     style={style}
 *     count={2}
 *     onPick={(draft) => { ... 把 draft.script.synopsis + shots 拼回 idea, 走 /api/create-stream ... }}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * UI 形态: 全屏 modal, 顶部进度, 中间 N 列卡, 底部 cancel + retry 按钮。
 */

import { useEffect, useState } from 'react';
import { X, CircleNotch as Loader2, Sparkle as Sparkles, ArrowsClockwise as RefreshCw, Check } from '@phosphor-icons/react';
import type { ScriptDraft } from '@/lib/script-drafts';

export interface ScriptDraftsCompareProps {
  idea: string;
  style?: string;
  count: 1 | 2 | 3;
  onPick: (draft: ScriptDraft) => void;
  onCancel: () => void;
}

export function ScriptDraftsCompare({
  idea, style, count, onPick, onCancel,
}: ScriptDraftsCompareProps) {
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<ScriptDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ requested: number; succeeded: number; elapsedMs: number } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setDrafts([]);
    try {
      const res = await fetch('/api/script-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, style, count }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || '草稿生成失败');
        return;
      }
      setDrafts(body.drafts || []);
      setStats(body.stats || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '草稿生成失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // 按 idea / count / style 重新拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea, count, style]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-6xl max-h-[90vh] rounded-2xl bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* header */}
        <div className="px-5 py-3 border-b border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--cinema-amber)]" />
            <h3 className="text-sm font-semibold text-[var(--cinema-text)]">
              剧本草稿对比 · {count} 版本
            </h3>
            {stats && !loading && (
              <span className="cinema-mono text-[10px] opacity-50">
                {stats.succeeded}/{stats.requested} 成功 · {(stats.elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30"
              title="重新生成"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onCancel}
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white"
              title="取消"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="py-12 text-center cinema-mono text-sm text-[var(--cinema-red)]">
              ✗ {error}
            </div>
          ) : loading ? (
            <div className="py-16 flex flex-col items-center gap-3 text-[var(--cinema-text-2)]">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--cinema-amber)]" />
              <p className="cinema-mono text-[11px] opacity-70">
                LLM 并行生成 {count} 个版本中, 通常 30-60s ...
              </p>
            </div>
          ) : (
            <div className={`grid gap-4 ${count === 1 ? '' : count === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
              {drafts.map((d, i) => (
                <DraftCard key={d.draftId} draft={d} index={i} onPick={() => onPick(d)} />
              ))}
            </div>
          )}
        </div>

        {/* footer hint */}
        <div className="px-5 py-2.5 border-t border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] cinema-mono text-[10.5px] text-[var(--cinema-text-3)] leading-relaxed">
          每个版本的温度 (T) 不同 — 数字越大风格越激进。点 <strong className="text-[var(--cinema-amber)]">采用此版</strong> 进入完整创作流程, 编剧 agent 会基于它做高质量改编。
        </div>
      </div>
    </div>
  );
}

function DraftCard({ draft, index, onPick }: { draft: ScriptDraft; index: number; onPick: () => void }) {
  const isError = !!draft.errorMessage;
  const tempLabel = draft.temperatureUsed >= 1.1 ? '激进' : draft.temperatureUsed >= 0.9 ? '中等' : '稳健';

  return (
    <div
      className={`cinema-card-hi p-4 flex flex-col gap-3 transition-all ${
        isError ? 'opacity-60 border-[var(--cinema-red)]/30' : 'hover:border-[var(--cinema-amber)]'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="cinema-mono text-[10px] tracking-widest opacity-50">
          DRAFT #{String(index + 1).padStart(2, '0')}
        </div>
        <div className="cinema-mono text-[10px] opacity-60">
          T={draft.temperatureUsed} · {tempLabel}
        </div>
      </div>

      {isError ? (
        <div className="py-8 text-center cinema-mono text-[11px] text-[var(--cinema-red)] opacity-70">
          ✗ 生成失败<br />
          <span className="opacity-60 text-[10px]">{draft.errorMessage?.slice(0, 80)}</span>
        </div>
      ) : draft.script ? (
        <>
          <h4 className="cinema-headline text-base text-[var(--cinema-text)] leading-tight">
            {draft.script.title || '(未命名)'}
          </h4>
          {draft.script.synopsis && (
            <p className="text-[12.5px] text-[var(--cinema-text-2)] line-clamp-3 leading-relaxed">
              {draft.script.synopsis}
            </p>
          )}
          <div className="flex items-center gap-2 cinema-mono text-[10px] text-[var(--cinema-text-3)] mt-1">
            <span>{draft.script.shots?.length || 0} 镜</span>
            {draft.estimatedWords ? <span>· ~{draft.estimatedWords} 字</span> : null}
            <span>· {draft.styleUsed}</span>
          </div>

          {/* v12.x(#2):逐镜预览 —— 全量展示 + 内部上下滑动(不再只露 2 镜) */}
          {draft.script.shots && draft.script.shots.length > 0 && (
            <ul className="space-y-1.5 mt-2 max-h-56 overflow-y-auto pr-1 cinema-scroll">
              {draft.script.shots.map((sh, j) => (
                <li
                  key={j}
                  className="text-[11.5px] text-[var(--cinema-text-2)] leading-relaxed border-l-2 border-[var(--cinema-amber)]/40 pl-2"
                >
                  <span className="cinema-mono text-[10px] opacity-50 mr-1">[{sh.shotNumber}]</span>
                  {sh.action || sh.sceneDescription || ''}
                  {sh.dialogue ? <span className="opacity-70"> · "{sh.dialogue.slice(0, 30)}"</span> : null}
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={onPick}
            className="cinema-btn cinema-btn-primary !text-[12px] !py-2 mt-auto inline-flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            采用此版
          </button>
        </>
      ) : null}
    </div>
  );
}
