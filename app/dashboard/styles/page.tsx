'use client';

/**
 * v6.3 — 风格模板画廊. 浏览 60 个命名风格预设 (写实/动漫/艺术/复古/实验) →
 * 一键套用到创作工坊 (经 sessionStorage 把风格名传给 /dashboard/create).
 * 数据 + 搜索/分类逻辑全在 lib/style-presets (已单测).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Palette, MagnifyingGlass as Search, Check, Sparkle as Sparkles, Flame } from '@phosphor-icons/react';
import type { StylePreset } from '@/types/agents';
import { STYLE_PRESETS, STYLE_CATEGORIES, categoryLabel, searchStyles } from '@/lib/style-presets';

export default function StylesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [applied, setApplied] = useState<string | null>(null);

  let list = searchStyles(q);
  if (cat !== 'all') list = list.filter((s) => s.category === cat);

  const apply = (s: StylePreset) => {
    try { sessionStorage.setItem('qfmj-create-style', s.nameEn); } catch { /* ignore */ }
    setApplied(s.id);
    setTimeout(() => router.push('/dashboard/create'), 220);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Palette className="w-6 h-6 text-amber-400" />
          风格画廊
        </h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          {STYLE_PRESETS.length} 个命名风格预设 · 一键套用到创作工坊,锁定全片画风
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索风格名 / 英文名 / 关键词…"
          className="w-full bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/40 transition-colors"
        />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[{ id: 'all', label: '全部' }, ...STYLE_CATEGORIES].map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] transition-all border ${
              cat === c.id
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-white/[0.03] text-[var(--muted)] border-[var(--border)] hover:text-white hover:border-white/20'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {list.length === 0 ? (
        <p className="text-sm text-[var(--muted)] text-center py-16">没有匹配的风格</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {list.map((s) => (
            <div key={s.id} className="rounded-2xl border border-[var(--border)] bg-white/[0.03] overflow-hidden group hover:-translate-y-1 hover:border-amber-500/40 transition-all">
              <div className="relative aspect-[4/3] bg-gradient-to-br from-amber-500/15 to-[#D4A830]/10 overflow-hidden">
                <img
                  src={s.thumbnail}
                  alt={s.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] text-amber-200">{categoryLabel(s.category)}</span>
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] text-white/80 flex items-center gap-0.5">
                  <Flame className="w-2.5 h-2.5 text-orange-400" />{s.popularity}
                </span>
              </div>
              <div className="p-3">
                <h4 className="text-sm font-semibold text-white truncate">{s.name}</h4>
                <p className="text-[11px] text-[var(--muted)] truncate">{s.nameEn}</p>
                {s.recommendedEngine && (
                  <p className="text-[10px] text-[var(--soft)] mt-1">推荐引擎 · {s.recommendedEngine}</p>
                )}
                <button
                  onClick={() => apply(s)}
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[12px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-all"
                >
                  {applied === s.id ? <><Check className="w-3.5 h-3.5" /> 已套用</> : <><Sparkles className="w-3.5 h-3.5" /> 套用此风格</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
