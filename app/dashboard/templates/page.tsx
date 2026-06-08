'use client';

/**
 * v9.6.8 — 模板市场页(阶段十六 T2)。浏览公开成片模板(画风+多参元素+节奏+质量分),
 * 「用此模板起片」→ POST /use 计数 + 把 payload 经 sessionStorage 交给创作工坊预填(同
 * 风格画廊「套用此风格」handoff)。
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Stack, MagicWand, MagnifyingGlass, Acorn, Star, Heart } from '@phosphor-icons/react';

interface ElementSummary { role: string; count: number; }
interface TemplatePayload { style?: string; styleEn?: string; genre?: string; pacingTone?: string; references?: unknown[]; lockedCharacters?: unknown[]; voiceOverrides?: Record<string, string>; previewUrl?: string; previewVideoUrl?: string; }
interface Template {
  id: string; title: string; style: string; genre?: string; pacingTone?: string;
  shotCount: number; quality: number; elements: ElementSummary[]; tags: string[];
  useCount: number; payload?: TemplatePayload | null;
  ratingAvg: number; ratingCount: number;
}

const ROLE_LABEL: Record<string, string> = { character: '角色', style: '画风', scene: '场景', prop: '道具', motion: '运镜', voice: '配音' };
const qColor = (q: number) => (q >= 80 ? 'text-emerald-400 border-emerald-400/30' : q >= 60 ? 'text-amber-400 border-amber-400/30' : 'text-rose-400 border-rose-400/30');

export default function TemplatesMarketPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favOnly, setFavOnly] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (query: string, fav: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (fav) params.set('fav', '1');
      const res = await fetch(`/api/templates${params.toString() ? `?${params}` : ''}`);
      const body = await res.json();
      if (res.ok) { setTemplates(body.templates || []); setFavoriteIds(new Set<string>(body.favoriteIds || [])); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load('', favOnly); }, [load, favOnly]);

  const toggleFav = useCallback(async (t: Template) => {
    const on = !favoriteIds.has(t.id);
    setFavoriteIds((s) => { const n = new Set(s); if (on) n.add(t.id); else n.delete(t.id); return n; });
    try { await fetch(`/api/templates/${encodeURIComponent(t.id)}/favorite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) }); } catch { /* 失败回滚下次刷新纠正 */ }
    if (favOnly && !on) setTemplates((ts) => ts.filter((x) => x.id !== t.id));
  }, [favoriteIds, favOnly]);

  const rate = useCallback(async (t: Template, stars: number) => {
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(t.id)}/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: stars }) });
      const b = await res.json();
      if (b.ok) setTemplates((ts) => ts.map((x) => x.id === t.id ? { ...x, ratingAvg: b.avg, ratingCount: b.count } : x));
    } catch { /* ignore */ }
  }, []);

  const startFromTemplate = useCallback(async (t: Template) => {
    try { await fetch(`/api/templates/${encodeURIComponent(t.id)}/use`, { method: 'POST' }); } catch { /* 计数失败不阻断 */ }
    try {
      const payload = t.payload || { style: t.style, genre: t.genre, pacingTone: t.pacingTone };
      sessionStorage.setItem('qfmj-create-template', JSON.stringify(payload));
    } catch { /* ignore */ }
    router.push('/dashboard/create');
  }, [router]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <Stack className="w-6 h-6 text-white/80" />
        <h1 className="text-xl font-semibold text-white/90">模板市场</h1>
      </div>
      <p className="text-sm text-white/45 mb-5">把出片好的项目沉淀成可复用模板 —— 画风 · 多参元素 · 节奏一键带走,直接起片。</p>

      <div className="flex items-center gap-2 mb-5 max-w-xl">
        <div className="flex items-center gap-2 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <MagnifyingGlass className="w-4 h-4 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(q, favOnly); }}
            placeholder="搜画风 / 类型 / 标签…"
            className="bg-transparent outline-none text-sm text-white/80 flex-1 placeholder:text-white/30"
          />
        </div>
        <button onClick={() => load(q, favOnly)} className="cinema-btn !px-3 !py-2 !text-xs">搜索</button>
        <button
          onClick={() => setFavOnly((v) => !v)}
          className={`cinema-btn !px-3 !py-2 !text-xs inline-flex items-center gap-1 ${favOnly ? '!text-rose-300 !border-rose-400/40' : ''}`}
        >
          <Heart weight={favOnly ? 'fill' : 'regular'} className="w-3.5 h-3.5" /> 只看收藏
        </button>
      </div>

      {loading ? (
        <div className="text-white/60 text-sm py-12 text-center">加载中…</div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-white/60 text-sm py-16">
          <Acorn className="w-8 h-8 text-white/20" />
          还没有模板 —— 在项目「技术监看」里把出片好的项目「存为模板」即可上架。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-3 hover:border-white/20 transition-colors">
              {/* v9.7.12 模板预览片:首镜成片(静音循环)或分镜图 */}
              {(t.payload?.previewVideoUrl || t.payload?.previewUrl) && (
                <div className="rounded-lg overflow-hidden bg-black/30 h-28 -mt-1">
                  {t.payload?.previewVideoUrl ? (
                    <video src={t.payload.previewVideoUrl} className="w-full h-full object-cover" autoPlay muted loop playsInline preload="metadata" />
                  ) : (
                    <img loading="lazy" decoding="async" src={t.payload!.previewUrl} alt={t.title} className="w-full h-full object-cover" />
                  )}
                </div>
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white/90 truncate">{t.title}</div>
                  <div className="text-[11px] text-white/45 mt-0.5">{t.style || '—'}{t.genre ? ` · ${t.genre}` : ''} · {t.shotCount} 镜</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${qColor(t.quality)}`}>质量 {t.quality}</span>
                  <button onClick={() => toggleFav(t)} aria-label="收藏" className="text-white/40 hover:text-rose-300 transition-colors">
                    <Heart weight={favoriteIds.has(t.id) ? 'fill' : 'regular'} className={`w-4 h-4 ${favoriteIds.has(t.id) ? 'text-rose-400' : ''}`} />
                  </button>
                </div>
              </div>

              {t.elements.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.elements.map((e) => (
                    <span key={e.role} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/55">
                      {ROLE_LABEL[e.role] || e.role} ×{e.count}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1">
                {t.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-[10px] text-white/60">#{tag}</span>
                ))}
              </div>

              {/* 评分:点星打分,显示均分 + 评分数 */}
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} onClick={() => rate(t, s)} aria-label={`评 ${s} 星`} className="text-amber-400/80 hover:text-amber-300 transition-colors">
                    <Star weight={s <= Math.round(t.ratingAvg) ? 'fill' : 'regular'} className="w-3.5 h-3.5" />
                  </button>
                ))}
                <span className="text-[10px] text-white/60 ml-1">{t.ratingCount > 0 ? `${t.ratingAvg} (${t.ratingCount})` : '暂无评分'}</span>
              </div>

              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-[11px] text-white/60">已被起片 {t.useCount} 次</span>
                <button onClick={() => startFromTemplate(t)} className="cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1">
                  <MagicWand className="w-3.5 h-3.5" /> 用此模板起片
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
