'use client';

/**
 * MusicGenPanel (v12.203) — 项目配乐入口。
 *
 * v12.203 病根:MiniMax music-2.6 生成(generateMusic)早已实现,前端零入口。
 *
 * v12.379:AI 作曲这条路**塌了** —— MiniMax 对本账号返回
 * HTTP 410 / status_code 2153「no longer available to new users」,
 * 而它曾是本项目唯一的配乐来源,于是整个片子没有任何办法配上背景乐。
 * 后端其实一直留着另一条口子(recompose 认 `bgmUrl`,优先级还在 music 资产之上),
 * 但全仓搜下来**前端零消费方** —— 又一次「能力做好了、入口没接」,
 * 只是因为 AI 作曲一直能用,没人发现。现在它成了唯一通路,所以补上。
 *
 * 两条路都落成同一个 `music` 资产,recompose 无需任何参数就能读到 ——
 * 不为「自备」另开一套语义。
 */

import { useRef, useState } from 'react';

type Source = 'ai' | 'upload';

export function MusicGenPanel({ projectId }: { projectId: string }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<Source | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** AI 作曲返回「接口已停用」时,提示语要改口 —— 让人再试一次是浪费时间 */
  const [aiGone, setAiGone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const token = () => (typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : '');
  const authHeader = (): Record<string, string> => {
    const t = token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const gen = async () => {
    setBusy('ai'); setErr(null); setUrl(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ prompt }),
      });
      const d = await res.json();
      if (!res.ok) {
        // v12.379:上游把「永久不可用」和「暂时失败」分得很清楚(v12.376 的错误码),
        // 界面也该分清 —— 对着一个已停用的接口反复重试是白费力气。
        if (d?.code === 'PROVIDER_DISCONTINUED') setAiGone(true);
        throw new Error(d?.message || '生成失败');
      }
      setUrl(d.musicUrl); setSource('ai');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy('upload'); setErr(null); setUrl(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/projects/${projectId}/music/upload`, {
        method: 'POST', headers: authHeader(), body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || '上传失败');
      setUrl(d.musicUrl); setSource('upload');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="cinema-card p-4 mb-4">
      <h3 className="text-sm font-semibold text-white/90 mb-1">🎵 项目配乐(BGM)</h3>
      <p className="text-[11px] text-white/45 mb-3">
        两条路都存为项目配乐,重新合成时自动用作背景乐。
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy !== null || aiGone}
          placeholder="例:悬疑 noir,低频大提琴,节奏沉重"
          className="cinema-input !text-xs !py-1.5 flex-1 min-w-[200px]"
        />
        <button
          onClick={gen}
          disabled={busy !== null || aiGone || prompt.trim().length < 4}
          className="cinema-btn-ghost !text-xs !py-1.5"
        >
          {busy === 'ai' ? '作曲中…(约1分钟)' : 'AI 作曲'}
        </button>
      </div>

      {aiGone && (
        <p className="text-[11px] text-amber-400/90 mt-2">
          AI 作曲接口已对本账号停用,重试和充值都无效 —— 请用下面的「上传自己的音乐」。
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-white/10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-white/60">上传自己的音乐</span>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            disabled={busy !== null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            className="text-[11px] text-white/50 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[11px] file:bg-white/10 file:text-white/80"
          />
          {busy === 'upload' && <span className="text-[11px] text-white/50">上传中…</span>}
        </div>
        <p className="text-[10px] text-white/35 mt-1">mp3 / wav / m4a 等,上限 20MB。请确认你有该音乐的使用权。</p>
      </div>

      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
      {url && (
        <div className="mt-2">
          <audio src={url} controls className="w-full h-8" />
          <p className="text-[10px] text-emerald-400/80 mt-1">
            ✓ 已存为项目配乐({source === 'upload' ? '自备' : 'AI 作曲'}),重新合成即用作 BGM。
          </p>
        </div>
      )}
    </div>
  );
}
