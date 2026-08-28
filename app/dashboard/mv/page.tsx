'use client';

/**
 * /dashboard/mv · MV 卡点规划台(v12.250 前端入口 → v12.246 /api/mv/plan)
 *
 * MV 模式的前端入口:给音乐时长 + BPM(+ 可选段落),后端算出**卡点镜头时间轴**
 * (每镜起止落在拍上、副歌加密、末镜贴合结尾)。本页把时间轴可视化成一条卡点色带 + 明细表。
 *
 * 诚实边界:本页只出**镜头规划**(切点),每镜配画面 → 卡点合成成片复用既有
 * generateImage / u2v / video-composer,是下一步(页内如实标注)。
 */

import { useEffect, useRef, useState } from 'react';
import { MusicNotes, Sparkle as Sparkles, Waveform, Warning as AlertTriangle, CircleNotch as Loader2, Upload, Images, FilmSlate, Download, X } from '@phosphor-icons/react';
import { useToast } from '@/components/ui/toast-provider';

interface MvShot {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  section: string;
  onBeat: boolean;
}

// 段落配色 —— 副歌最亮(金),主歌次之,过渡/首尾偏冷,和「副歌加密」的语义呼应。
const SECTION_COLOR: Record<string, string> = {
  chorus: '#E8C547',
  verse: '#4A7EBB',
  bridge: '#9B6DC4',
  intro: '#3F8F7A',
  outro: '#8A6D3B',
  unknown: '#555',
};
const SECTION_LABEL: Record<string, string> = {
  chorus: '副歌', verse: '主歌', bridge: '过渡', intro: '前奏', outro: '尾奏', unknown: '—',
};

export default function MvPlanPage() {
  const [durationSec, setDurationSec] = useState(60);
  const [bpm, setBpm] = useState(120);
  const [beatsPerShot, setBeatsPerShot] = useState(8);
  const [planning, setPlanning] = useState(false);
  const [shots, setShots] = useState<MvShot[] | null>(null);
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  // v12.253 出片态
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // v12.254 真视频片段:填了就用真片段(每段按拍裁切),留空则用上面的静帧动效
  const [videoClips, setVideoClips] = useState<string[]>([]);
  const [clipDraft, setClipDraft] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  // v12.351:BPM 自动检测状态
  const [bpmBusy, setBpmBusy] = useState(false);
  const [bpmNote, setBpmNote] = useState('');
  const [composing, setComposing] = useState(false);
  const [mvUrl, setMvUrl] = useState('');
  const [mvDuration, setMvDuration] = useState(0); // 成片实际时长,用于和规划时长比对(真片段短于卡点时会缩短)
  const [mvMusicDropped, setMvMusicDropped] = useState(false); // 配乐被丢(格式不对/超 64MB)→ 诚实提示
  const [composeError, setComposeError] = useState('');
  // 出片用**生成时间轴那一刻的参数快照**,而非当前 live 输入 —— 否则用户改了 BPM 没重新规划,
  // 合成出来的镜头数会和上面显示的时间轴对不上,却仍报「合成完成」(复检 medium)。
  const [plannedParams, setPlannedParams] = useState<{ durationSec: number; bpm: number; beatsPerShot: number } | null>(null);
  const imgRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToast();

  // v12.255:支持 ?clip=<url> 预填真片段(「单图变视频」成片页「加入 MV 片段」交接用)。
  // 用 window.location 读,避免 useSearchParams 的 Suspense 边界要求;仅接受同站 serve-file / http(s)(视频不收 data:)。
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('clip');
      if (q && /^(\/api\/serve-file|https?:)/.test(q)) {
        setVideoClips((prev) => (prev.includes(q) ? prev : [...prev, q]).slice(0, 40));
      }
    } catch { /* noop */ }
  }, []);

  // v12.351:从配乐自动测 BPM。测不出就**说测不出并保留手填**,不塞一个编出来的数。
  const detectBpm = async () => {
    if (!musicUrl.trim()) return;
    setBpmBusy(true); setBpmNote('');
    try {
      const res = await fetch('/api/mv/detect-bpm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicUrl: musicUrl.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setBpmNote(j?.reason || j?.error || `检测失败(HTTP ${res.status})—— 请手动填写`);
        return;
      }
      setBpm(Math.round(j.bpm));
      setBpmNote(
        `测得 ${j.bpm} BPM(拍点 ${j.beats} 个 · 齐整度 ${Math.round((j.confidence || 0) * 100)}%)` +
        (j.note ? ` · ${j.note}` : ''),
      );
    } catch (e) {
      setBpmNote((e instanceof Error ? e.message : '检测失败') + ' —— 请手动填写');
    } finally {
      setBpmBusy(false);
    }
  };

  const plan = async () => {
    setPlanning(true);
    setErrorMsg('');
    setShots(null);
    setMvUrl(''); setMvDuration(0); setMvMusicDropped(false); setComposeError('');
    try {
      const res = await fetch('/api/mv/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicDurationSec: durationSec, bpm, beatsPerShot }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.message || `规划失败 (HTTP ${res.status})`;
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setShots(body.shots || []);
      setSummary(body.summary || '');
      setPlannedParams({ durationSec, bpm, beatsPerShot }); // 快照:出片按这组参数,和显示的时间轴一致
      showToast({ title: `已规划 ${body.shotCount} 个卡点镜头`, type: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,规划失败';
      setErrorMsg(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setPlanning(false);
    }
  };

  const uploadImages = async (files: FileList) => {
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 40)) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) { showToast({ title: `${file.name} 超过 10MB,跳过`, type: 'warning' }); continue; }
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch('/api/upload/character-face', { method: 'POST', body: form });
          const body = await res.json().catch(() => ({}));
          if (res.ok && body.url) added.push(body.url);
          else showToast({ title: body.error || `${file.name} 上传失败`, type: 'error' });
        } catch { showToast({ title: `${file.name} 上传失败,请检查网络`, type: 'error' }); }
      }
      if (added.length) setImages((prev) => [...prev, ...added].slice(0, 40));
    } finally {
      setUploading(false);
    }
  };

  const addClip = () => {
    const u = clipDraft.trim();
    if (!u) return;
    if (!/^(https?:\/\/|\/api\/serve-file)/.test(u)) { showToast({ title: '片段 URL 需为 http(s) 或站内 serve-file', type: 'error' }); return; }
    setVideoClips((prev) => (prev.includes(u) ? prev : [...prev, u]).slice(0, 40));
    setClipDraft('');
  };

  const useRealClips = videoClips.length > 0;

  const compose = async () => {
    if (!shots || shots.length === 0 || !plannedParams) { showToast({ title: '先生成卡点时间轴', type: 'error' }); return; }
    if (!useRealClips && images.length === 0) { showToast({ title: '先上传画面,或添加真视频片段', type: 'error' }); return; }
    setComposing(true);
    setMvUrl(''); setMvDuration(0); setMvMusicDropped(false); setComposeError('');
    try {
      // 用快照参数,保证合成的镜头数 == 上面显示的时间轴(而非可能被改动的 live 输入)。
      // 填了真片段就走真片段(每段按拍裁切),否则用静帧动效。
      const res = await fetch('/api/mv/compose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          musicDurationSec: plannedParams.durationSec, bpm: plannedParams.bpm, beatsPerShot: plannedParams.beatsPerShot,
          ...(useRealClips ? { videoClips } : { imageUrls: images }),
          musicUrl: musicUrl.trim() || undefined, aspect: '9:16',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        const msg = body?.message || `合成失败 (HTTP ${res.status})`;
        setComposeError(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setMvUrl(body.finalVideoUrl || '');
      setMvDuration(Number(body.duration) || 0);
      setMvMusicDropped(!!body.musicDropped);
      showToast({ title: body.musicDropped ? 'MV 已合成(配乐被跳过)' : 'MV 已合成', type: body.musicDropped ? 'warning' : 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,合成失败';
      setComposeError(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setComposing(false);
    }
  };

  const total = shots && shots.length ? shots[shots.length - 1].endSec : durationSec;

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MusicNotes className="w-6 h-6 text-[#E8C547]" weight="duotone" />
          MV 卡点规划台
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          给音乐时长 + BPM,AI 算出每镜落在拍上的**卡点时间轴**(副歌自动加密、末镜贴合结尾)。
          规划完成后,每镜配画面 → 卡点合成复用既有出片链路(下一步)。
        </p>
      </div>

      {/* 输入区 */}
      <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">音乐时长(秒)</label>
            <input
              type="number" min={1} max={600} value={durationSec}
              onChange={e => setDurationSec(Number(e.target.value))}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm tabular-nums"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-[var(--soft)] uppercase tracking-wider">BPM(每分钟拍数)</label>
              {/* v12.351:检测函数从 v12.246 就在,这里却一直让用户自己数拍子。 */}
              <button
                type="button"
                onClick={detectBpm}
                disabled={bpmBusy || !musicUrl.trim()}
                data-testid="detect-bpm"
                className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 hover:border-[#E8C547]/50 disabled:opacity-40 disabled:cursor-not-allowed"
                title={musicUrl.trim() ? '从配乐自动测 BPM' : '先填配乐 URL'}
              >
                {bpmBusy ? '检测中…' : '自动检测'}
              </button>
            </div>
            <input
              type="number" min={1} max={400} value={bpm}
              onChange={e => setBpm(Number(e.target.value))}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm tabular-nums"
            />
            {bpmNote && (
              <div role="status" className="text-[10px] mt-1 opacity-70 leading-relaxed">{bpmNote}</div>
            )}
          </div>
          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">每镜拍数</label>
            <input
              type="number" min={1} max={64} value={beatsPerShot}
              onChange={e => setBeatsPerShot(Number(e.target.value))}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm tabular-nums"
            />
            <div className="text-[10px] text-[var(--soft)] mt-1 opacity-60">越小切得越碎;副歌会自动减半加密</div>
          </div>
        </div>

        <button
          onClick={plan}
          disabled={planning || !(durationSec > 0) || !(bpm > 0) || !(beatsPerShot > 0)}
          className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2"
        >
          {planning ? (<><Loader2 className="w-4 h-4 animate-spin" /> 规划中…</>) : (<><Waveform className="w-4 h-4" weight="bold" /> 生成卡点时间轴</>)}
        </button>
      </div>

      {/* 结果区 */}
      <div className="mt-5">
        {errorMsg ? (
          <div className="bg-[rgba(255,255,255,0.04)] border border-rose-500/20 rounded-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
            <div className="text-sm text-rose-300 mb-1">规划失败</div>
            <div className="text-[11px] text-white/50">{errorMsg}</div>
          </div>
        ) : shots && shots.length === 0 ? (
          // 规划成功但零镜头(如节拍太快):要和「还没点」区分,并把 summary 显出来,别让结果静默消失。
          <div className="bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-2xl p-6 text-center">
            <div className="text-sm text-[var(--muted)] mb-1">{summary || '没有可规划的卡点镜头'}</div>
            <div className="text-[11px] text-[var(--soft)]">试试调低 BPM 或每镜拍数、或加长音乐时长。</div>
          </div>
        ) : shots && shots.length > 0 ? (
          <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#E8C547]" weight="duotone" />
              <span className="text-sm text-white font-medium">{summary}</span>
            </div>

            {/* 卡点色带:每镜按时长占比着色,段落配色 */}
            <div className="flex w-full h-9 rounded-lg overflow-hidden border border-white/10 mb-2" role="img" aria-label="卡点镜头时间轴">
              {shots.map((s) => (
                <div
                  key={s.index}
                  title={`第${s.index}镜 · ${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}s · ${SECTION_LABEL[s.section] || s.section}`}
                  style={{ width: `${(s.durationSec / total) * 100}%`, background: SECTION_COLOR[s.section] || SECTION_COLOR.unknown }}
                  className="h-full border-r border-black/30 last:border-r-0 grid place-items-center text-[9px] font-mono text-black/70 overflow-hidden"
                >
                  {(s.durationSec / total) > 0.05 ? s.index : ''}
                </div>
              ))}
            </div>
            {/* 段落图例 */}
            <div className="flex flex-wrap gap-3 mb-4 text-[10px] text-[var(--soft)]">
              {Array.from(new Set(shots.map(s => s.section))).map(sec => (
                <span key={sec} className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SECTION_COLOR[sec] || SECTION_COLOR.unknown }} />
                  {SECTION_LABEL[sec] || sec}
                </span>
              ))}
            </div>

            {/* 明细表 */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--soft)] text-left border-b border-white/10">
                    <th className="py-1.5 pr-3 font-medium">镜</th>
                    <th className="py-1.5 pr-3 font-medium">起(s)</th>
                    <th className="py-1.5 pr-3 font-medium">止(s)</th>
                    <th className="py-1.5 pr-3 font-medium">时长(s)</th>
                    <th className="py-1.5 pr-3 font-medium">段落</th>
                    <th className="py-1.5 font-medium">对齐拍</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {shots.map((s) => (
                    <tr key={s.index} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 pr-3 text-white">{s.index}</td>
                      <td className="py-1.5 pr-3 text-[var(--muted)]">{s.startSec.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-[var(--muted)]">{s.endSec.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-[var(--muted)]">{s.durationSec.toFixed(2)}</td>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm" style={{ background: SECTION_COLOR[s.section] || SECTION_COLOR.unknown }} />
                          {SECTION_LABEL[s.section] || s.section}
                        </span>
                      </td>
                      <td className="py-1.5 text-emerald-400">{s.onBeat ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* v12.253 出片:传画面 → 按卡点时间轴静帧动画 + 卡点硬切拼接 + 配乐 */}
            <div className="mt-5 pt-4 border-t border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <FilmSlate className="w-4 h-4 text-[#E8C547]" weight="duotone" />
                <span className="text-sm text-white font-medium">出片 · 给每镜配画面</span>
              </div>
              <p className="text-[11px] text-[var(--soft)] mb-3 opacity-70">
                两种画面来源(填了**真片段**就优先用真片段):<br />
                · <b className="text-white/80">真视频片段</b> —— 贴几段视频 URL(可来自「单图变视频」的成片,或你自己的片段),每段按卡点时长硬切成按拍剪辑的真片段 MV。<br />
                · <b className="text-white/80">静帧动效</b> —— 传几张图,每镜做 ken-burns 动画再硬切。<br />
                不够都会循环用。可选配乐。
              </p>

              {/* v12.254 真视频片段(优先) */}
              <div className="mb-4">
                <div className="text-[11px] text-[var(--soft)] uppercase tracking-wider mb-1.5">真视频片段(优先 · 每段按拍裁切)</div>
                {videoClips.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {videoClips.map((u, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] bg-black/25 rounded px-2 py-1">
                        <span className="w-4 h-4 rounded bg-[#E8C547]/15 text-[#E8C547] grid place-items-center font-mono shrink-0">{i + 1}</span>
                        <span className="flex-1 truncate text-[var(--muted)]" title={u}>{u}</span>
                        <button onClick={() => setVideoClips((prev) => prev.filter((_, j) => j !== i))} title="移除" className="text-[var(--soft)] hover:text-rose-300"><X className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-1.5">
                  <input
                    type="url" value={clipDraft} onChange={e => setClipDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addClip(); }}
                    placeholder="视频片段 URL(http(s) 或站内 serve-file)"
                    className="flex-1 px-2 py-1.5 bg-black/30 border border-white/10 rounded text-xs focus:outline-none focus:border-[#E8C547]/50"
                  />
                  <button onClick={addClip} disabled={!clipDraft.trim()} className="px-3 py-1 text-xs rounded bg-[#E8C547]/15 text-[#E8C547] hover:bg-[#E8C547]/25 disabled:opacity-40">加片段</button>
                </div>
              </div>

              {/* 画面上传(真片段留空时用) */}
              <div className="flex flex-wrap gap-2 mb-3">
                {images.map((u, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 group">
                    <img loading="lazy" decoding="async" src={u} alt={`画面 ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                      title="移除" className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition"
                    ><X className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
                <button
                  onClick={() => imgRef.current?.click()}
                  disabled={uploading}
                  className="w-16 h-16 rounded-lg border border-dashed border-white/20 grid place-items-center text-[var(--soft)] hover:bg-white/5 disabled:opacity-40"
                  title="上传画面"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                </button>
                <input ref={imgRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { if (e.target.files?.length) uploadImages(e.target.files); if (imgRef.current) imgRef.current.value = ''; }} />
              </div>

              {/* 配乐(可选) */}
              <input
                type="url" value={musicUrl} onChange={e => setMusicUrl(e.target.value)}
                placeholder="配乐 URL(可选,http(s) 或站内 serve-file)"
                className="w-full px-3 py-2 mb-3 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-xs"
              />

              <button
                onClick={compose}
                disabled={composing || (!useRealClips && images.length === 0)}
                className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2 text-sm"
              >
                {composing
                  ? (<><Loader2 className="w-4 h-4 animate-spin" /> 合成中…(每镜一次渲染,稍候)</>)
                  : useRealClips
                    ? (<><FilmSlate className="w-4 h-4" weight="bold" /> 生成 MV({videoClips.length} 段真片段 × {shots.length} 镜)</>)
                    : (<><Images className="w-4 h-4" weight="bold" /> 生成 MV({images.length} 张画面 × {shots.length} 镜)</>)}
              </button>

              {composeError && <div className="mt-2 text-[12px] text-rose-300">✕ {composeError}</div>}
              {mvUrl && (
                <div className="mt-4">
                  <div className="text-[12px] text-emerald-400 mb-2 inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4" weight="duotone" /> MV 合成完成</div>
                  {mvMusicDropped && (
                    <div className="text-[11px] text-amber-300/85 mb-2">⚠ 配乐未生效(URL 格式不对或超 64MB 被限流)—— 成片无 BGM,其余正常。</div>
                  )}
                  {/* 诚实提示:真片段短于其镜卡点时长时,composeVideo 只能用完整段,成片会短于规划时间轴。 */}
                  {mvDuration > 0 && total > 0 && mvDuration < total * 0.9 && (
                    <div className="text-[11px] text-amber-300/85 mb-2 leading-relaxed">
                      ⚠ 成片 {mvDuration.toFixed(1)}s,短于规划的 {total.toFixed(1)}s —— 有片段短于其镜卡点时长,已按片段实际长度用(想严格贴拍,请让每段片段 ≥ 对应镜的卡点时长)。
                    </div>
                  )}
                  <video src={mvUrl} controls className="w-full rounded-xl bg-black/40 max-h-[460px]" />
                  <a href={mvUrl} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-white">
                    <Download className="w-3.5 h-3.5" /> 打开 / 下载 MV
                  </a>
                </div>
              )}
              <p className="text-[11px] text-[var(--soft)] mt-3 opacity-60 leading-relaxed">
                ✦ 真片段最好每段 ≥ 对应镜的卡点时长(短了会缩短成片);片段可来自「单图变视频」成片或你自己的素材。
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center text-[var(--soft)] text-sm opacity-60 py-10">
            填时长与 BPM,点「生成卡点时间轴」——结果会出现在这里。
          </div>
        )}
      </div>
    </div>
  );
}
