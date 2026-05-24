'use client';

/**
 * v6.2.1 — 长篇拆解工作台 UI.
 * 粘贴长篇小说/剧本 → 自动分集预览 + 叙事模式选择 → 逐集送入创作工坊 (orchestrator).
 * 拆分逻辑全在 lib/story-intake (已单测, client-safe); 这里只做交互 + 把某集 + 叙事指令
 * 经 sessionStorage 交给 /dashboard/create (避免长文本超 URL 长度).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScrollText, Sparkles, ChevronRight, Layers, Mic } from 'lucide-react';
import {
  splitIntoEpisodes, NARRATION_MODES, getNarrationMode,
  type Episode, type NarrationMode,
} from '@/lib/story-intake';

export default function StoryIntakePage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<NarrationMode>('dialogue');
  const [targetChars, setTargetChars] = useState<string>('');
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);

  const doSplit = () => {
    const tc = parseInt(targetChars, 10);
    const eps = splitIntoEpisodes(text, { targetChars: Number.isFinite(tc) && tc > 0 ? tc : undefined });
    setEpisodes(eps);
  };

  const sendToCreate = (ep: Episode) => {
    const nm = getNarrationMode(mode);
    const seed = `【叙事模式:${nm.label}】${nm.directive}\n\n${ep.title}\n${ep.text}`;
    try { sessionStorage.setItem('qfmj-create-seed', seed); } catch { /* ignore */ }
    router.push('/dashboard/create');
  };

  const totalChars = text.trim().length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-amber-400" />
          长篇拆解
        </h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          粘贴长篇小说 / 剧本 → 自动分集 + 选叙事模式 → 逐集送入创作工坊
        </p>
      </div>

      {/* Input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'粘贴整部小说或长剧本…\n\n· 有「第X章 / Chapter N / ## 标题」标记 → 按标记分集\n· 没有标记 → 按目标字数自动分集'}
        rows={10}
        className="w-full bg-black/40 border border-[var(--border)] rounded-2xl p-4 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-amber-500/40 transition-colors resize-y"
      />

      {/* Controls */}
      <div className="mt-3 flex flex-col gap-3">
        {/* 叙事模式 */}
        <div>
          <p className="text-xs text-[var(--muted)] mb-1.5 flex items-center gap-1"><Mic className="w-3 h-3" /> 叙事模式</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {NARRATION_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`text-left p-2.5 rounded-xl border transition-all ${
                  mode === m.id ? 'border-amber-500/50 bg-amber-500/10' : 'border-[var(--border)] bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <div className={`text-sm font-medium ${mode === m.id ? 'text-amber-300' : 'text-white'}`}>{m.label}</div>
                <div className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{m.description}</div>
                {m.generatesNarrationTrack && <div className="text-[10px] text-violet-300/80 mt-1">+ 解说音轨</div>}
              </button>
            ))}
          </div>
        </div>

        {/* target + 拆解 */}
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <p className="text-xs text-[var(--muted)] mb-1.5">单集目标字数(可选,无章节标记时生效)</p>
            <input
              type="number"
              value={targetChars}
              onChange={(e) => setTargetChars(e.target.value)}
              placeholder="默认 2000"
              className="w-40 bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-amber-500/40"
            />
          </div>
          <button
            onClick={doSplit}
            disabled={totalChars === 0}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            <Layers className="w-4 h-4" /> 智能拆解
          </button>
          {totalChars > 0 && <span className="text-[11px] text-[var(--muted)] pb-2">共 {totalChars} 字</span>}
        </div>
      </div>

      {/* Episodes */}
      {episodes && (
        <div className="mt-6">
          {episodes.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-10">未识别到可拆解的内容</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-white">拆出 {episodes.length} 集 · 叙事:{getNarrationMode(mode).label}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {episodes.map((ep) => (
                  <div key={ep.index} className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <h4 className="text-sm font-semibold text-white truncate">
                        <span className="text-amber-400 mr-1.5">EP{ep.index}</span>{ep.title}
                      </h4>
                      <span className="text-[10px] text-[var(--muted)] shrink-0">{ep.charCount} 字</span>
                    </div>
                    <p className="text-[12px] text-[var(--muted)] leading-relaxed line-clamp-3 flex-1">
                      {ep.text.slice(0, 160)}
                    </p>
                    <button
                      onClick={() => sendToCreate(ep)}
                      className="mt-3 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium bg-[#E8C547]/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> 用此集创作
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
