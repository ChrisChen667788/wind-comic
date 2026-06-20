'use client';

/**
 * 我的系列(阶段二十六 · v12.20.0)—— 列出本人所有系列剧,进各系列批量生成面板。
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { FilmSlate, CircleNotch as Loader2, CaretRight, Plus } from '@phosphor-icons/react';

interface SeriesSummary { seriesId: string; episodeCount: number; doneCount: number; sampleTitle: string; updatedAt: string }

/** 从样例剧集标题(「<系列> 第N集 …」)推出系列名。 */
function seriesName(sampleTitle: string, seriesId: string): string {
  const cut = (sampleTitle || '').split(' 第')[0].trim();
  return cut || seriesId;
}

export default function MySeriesPage() {
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const t = getToken();
      const res = await fetch('/api/series', { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      const body = await res.json();
      if (res.ok && Array.isArray(body.series)) setSeries(body.series);
    } catch { /* 静默 */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 grid place-items-center"><FilmSlate className="w-6 h-6 text-cyan-400" /></div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">我的系列</h1>
          <p className="text-xs text-gray-500">系列剧 · 跨集一致 · 一键批量出片</p>
        </div>
        <Link href="/dashboard/series/new" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-medium">
          <Plus className="w-4 h-4" /> 新建系列
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中…</div>
      ) : series.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">
          还没有系列剧。<br />
          <span className="text-gray-600 text-xs">用 <code className="text-cyan-300/80">POST /api/series</code> 把一个项目设为锚点集,即可生成续集系列。</span>
        </div>
      ) : (
        <div className="space-y-2">
          {series.map((s) => (
            <Link key={s.seriesId} href={`/dashboard/series/${encodeURIComponent(s.seriesId)}`}
              className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 hover:border-cyan-500/30 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{seriesName(s.sampleTitle, s.seriesId)}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{s.episodeCount} 集 · 已完成 {s.doneCount}/{s.episodeCount}</div>
              </div>
              <div className="h-1.5 w-24 bg-white/5 rounded-full overflow-hidden shrink-0">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-400" style={{ width: `${s.episodeCount ? Math.round((s.doneCount / s.episodeCount) * 100) : 0}%` }} />
              </div>
              <CaretRight className="w-4 h-4 text-gray-500 group-hover:text-cyan-400 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
