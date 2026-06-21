'use client';

/**
 * 系列剧面板(阶段二十六 · v12.18.0)—— 看整季各集状态 + 一键批量生成。
 * 各集 draft→active→completed;有「生成中」时每 5s 轮询刷新。
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { FilmStrip as Film, CircleNotch as Loader2, CheckCircle as CheckCircle2, Clock, Play, ArrowLeft, Image as ImageIcon, DownloadSimple } from '@phosphor-icons/react';

interface Episode { id: string; title: string; status: string; episode_number: number | null; aspect: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '待生成', cls: 'text-gray-400 bg-white/5 border-white/10' },
  active: { label: '生成中', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  completed: { label: '已完成', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  failed: { label: '失败·可重试', cls: 'text-red-300 bg-red-500/10 border-red-500/30' },
};

export default function SeriesPanel() {
  const params = useParams();
  const seriesId = String(params?.id || '');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  // v12.25.0 季级产物
  const [seasonCover, setSeasonCover] = useState<string | null>(null);
  const [seasonVideo, setSeasonVideo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}`, { headers: authHeaders() });
      const body = await res.json();
      if (res.ok && Array.isArray(body.episodes)) {
        setEpisodes(body.episodes);
        setSeasonCover(body.seasonCover ?? null);
        setSeasonVideo(body.seasonVideo ?? null);
      } else if (!res.ok) {
        setMsg(body?.error || `加载失败 ${res.status},请刷新重试`); // v12.26.0:加载失败不再静默
      }
    } catch { setMsg('加载失败,请检查网络后刷新'); } finally { setLoading(false); }
  }, [seriesId, authHeaders]);

  useEffect(() => { load(); }, [load]);

  // 有「生成中」就轮询。v12.23.0:依赖布尔 hasActive(非 episodes 引用),避免每次 load 后重建 interval。
  const hasActive = episodes.some((e) => e.status === 'active');
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [hasActive, load]);

  const batchGenerate = async (force = false) => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/generate`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ force }),
      });
      const body = await res.json();
      if (!res.ok) { setMsg(body?.error || `失败 ${res.status}`); return; }
      // v12.23.0:队列模式无 concurrency 字段,按 mode 分支文案(不再显示「并发 undefined」)
      setMsg(body.started > 0
        ? (body.mode === 'queue'
            ? `已入队批量生成 ${body.started} 集(持久队列,逐集进行中…)`
            : `已开始批量生成 ${body.started} 集(并发 ${body.concurrency},逐集进行中…)`)
        : (body.message || '没有待生成的剧集'));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : '请求失败'); }
    finally { setBusy(false); }
  };

  // v12.25.0:导出整季合集
  const exportSeason = async () => {
    if (exporting) return;
    setExporting(true); setMsg('整季合集生成中(下载各集 + 拼接重编码,最长约 5 分钟,请勿关闭页面)…');
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/export`, { method: 'POST', headers: authHeaders(), body: '{}' });
      const body = await res.json();
      if (!res.ok) { setMsg(body?.error || `导出失败 ${res.status}`); return; }
      setSeasonVideo(body.videoUrl); setMsg(`整季合集已生成(${body.count} 集)`);
    } catch (e) { setMsg(e instanceof Error ? e.message : '请求失败'); }
    finally { setExporting(false); }
  };

  // v12.25.0:生成季封面
  const genCover = async () => {
    if (coverBusy) return;
    setCoverBusy(true); setMsg('季封面生成中…');
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/cover`, { method: 'POST', headers: authHeaders(), body: '{}' });
      const body = await res.json();
      if (!res.ok) { setMsg(body?.error || `封面生成失败 ${res.status}`); return; }
      setSeasonCover(body.coverUrl); setMsg('季封面已生成');
    } catch (e) { setMsg(e instanceof Error ? e.message : '请求失败'); }
    finally { setCoverBusy(false); }
  };

  const pending = episodes.filter((e) => e.status === 'draft' || e.status === 'failed').length; // 待生成 + 失败可重试
  const generating = episodes.filter((e) => e.status === 'active').length;
  const done = episodes.filter((e) => e.status === 'completed').length;
  const failed = episodes.filter((e) => e.status === 'failed').length;

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
        {failed > 0 && <span className="text-red-300">失败 {failed}</span>}
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

      {/* v12.25.0 季级产物:封面 + 整季合集 */}
      <div className="flex items-start gap-4 mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="w-20 shrink-0 rounded-lg overflow-hidden bg-black/30 aspect-[3/4] grid place-items-center">
          {seasonCover ? <img src={seasonCover} alt="季封面" className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-gray-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white mb-2">季级产物</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={genCover} disabled={coverBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-gray-200 text-xs hover:text-white disabled:opacity-40">
              {coverBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {seasonCover ? '重生季封面' : '生成季封面'}
            </button>
            <button onClick={exportSeason} disabled={exporting || done === 0}
              title={done === 0 ? '先生成至少一集' : ''}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-gray-200 text-xs hover:text-white disabled:opacity-40">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DownloadSimple className="w-3.5 h-3.5" />}
              {seasonVideo ? '重导整季合集' : '导出整季合集'}
            </button>
            {seasonVideo && (
              <a href={seasonVideo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                <Play className="w-3.5 h-3.5" /> 看整季合集
              </a>
            )}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">合集 = 已完成各集成片按集号拼接(归一画幅 + 重编码)。</p>
        </div>
      </div>

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
                <span className="text-cyan-400 font-bold text-sm w-12 shrink-0">第{ep.episode_number ?? '?'}集</span>
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
