'use client';

/**
 * 系列剧面板(阶段二十六 · v12.18.0)—— 看整季各集状态 + 一键批量生成。
 * 各集 draft→active→completed;有「生成中」时每 5s 轮询刷新。
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { FilmStrip as Film, CircleNotch as Loader2, CheckCircle as CheckCircle2, Clock, Play, ArrowLeft } from '@phosphor-icons/react';

interface Episode { id: string; title: string; status: string; episode_number: number | null; aspect: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '待生成', cls: 'text-gray-400 bg-white/5 border-white/10' },
  active: { label: '生成中', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  completed: { label: '已完成', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
};

export default function SeriesPanel() {
  const params = useParams();
  const seriesId = String(params?.id || '');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');

  const authHeaders = useCallback((): Record<string, string> => {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}`, { headers: authHeaders() });
      const body = await res.json();
      if (res.ok && Array.isArray(body.episodes)) setEpisodes(body.episodes);
    } catch { /* 静默 */ } finally { setLoading(false); }
  }, [seriesId, authHeaders]);

  useEffect(() => { load(); }, [load]);

  // 有「生成中」就轮询
  useEffect(() => {
    if (!episodes.some((e) => e.status === 'active')) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [episodes, load]);

  const batchGenerate = async (force = false) => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/generate`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ force }),
      });
      const body = await res.json();
      if (!res.ok) { setMsg(body?.error || `失败 ${res.status}`); return; }
      setMsg(body.started > 0 ? `已开始批量生成 ${body.started} 集(并发 ${body.concurrency},逐集进行中…)` : (body.message || '没有待生成的剧集'));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : '请求失败'); }
    finally { setBusy(false); }
  };

  const pending = episodes.filter((e) => e.status === 'draft').length;
  const generating = episodes.filter((e) => e.status === 'active').length;
  const done = episodes.filter((e) => e.status === 'completed').length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> 返回
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 grid place-items-center"><Film className="w-6 h-6 text-cyan-400" /></div>
        <div>
          <h1 className="text-xl font-bold text-white">系列剧 · 批量生成</h1>
          <p className="text-xs text-gray-500 font-mono">{seriesId}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-400 mt-3 mb-5">
        <span>共 {episodes.length} 集</span>
        <span className="text-emerald-400">已完成 {done}</span>
        <span className="text-amber-300">生成中 {generating}</span>
        <span>待生成 {pending}</span>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => batchGenerate(false)}
          disabled={busy || pending === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-medium disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          一键批量生成{pending > 0 ? `(${pending} 集待生成)` : ''}
        </button>
        {done > 0 && (
          <button onClick={() => batchGenerate(true)} disabled={busy}
            className="px-3 py-2 rounded-xl border border-white/15 text-gray-300 text-xs hover:text-white disabled:opacity-40">
            全部重生
          </button>
        )}
      </div>

      {msg && <div className="mb-4 text-[13px] text-cyan-200/90 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">{msg}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中…</div>
      ) : episodes.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">该系列暂无剧集</div>
      ) : (
        <div className="space-y-2">
          {episodes.map((ep) => {
            const st = STATUS[ep.status] || STATUS.draft;
            return (
              <div key={ep.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <span className="text-cyan-400 font-bold text-sm w-12 shrink-0">第{ep.episode_number}集</span>
                <span className="flex-1 text-sm text-white truncate">{ep.title}</span>
                {ep.aspect && <span className="text-[10px] text-gray-500 font-mono">{ep.aspect}</span>}
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${st.cls}`}>
                  {ep.status === 'active' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {ep.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                  {ep.status === 'draft' && <Clock className="w-3 h-3" />}
                  {st.label}
                </span>
                <Link href={`/projects/${ep.id}`} className="text-[11px] text-cyan-300 hover:text-cyan-200 shrink-0">打开 →</Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
