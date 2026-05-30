'use client';

/**
 * v3.5.1 — 平台导出下拉.
 *
 * 一键把成片导出成抖音/快手/小红书/B站横屏等版本 (横竖屏 + 平台字幕风格).
 * 调 POST /api/projects/[id]/export-platform.
 */

import { useState } from 'react';
import { ShareNetwork as Share2, CircleNotch as Loader2, Check, CaretDown as ChevronDown } from '@phosphor-icons/react';

interface Preset {
  key: string;
  label: string;
  aspect: '9:16' | '16:9' | '1:1' | '4:5';
  subtitlePlatform?: 'douyin' | 'kuaishou' | 'xiaohongshu' | 'youtube';
}

const PRESETS: Preset[] = [
  { key: 'douyin', label: '抖音竖屏 9:16', aspect: '9:16', subtitlePlatform: 'douyin' },
  { key: 'kuaishou', label: '快手竖屏 9:16', aspect: '9:16', subtitlePlatform: 'kuaishou' },
  { key: 'xhs', label: '小红书 4:5', aspect: '4:5', subtitlePlatform: 'xiaohongshu' },
  { key: 'youtube', label: 'YouTube 横屏 16:9', aspect: '16:9', subtitlePlatform: 'youtube' },
  { key: 'square', label: '方形 1:1', aspect: '1:1' },
];

export function PlatformExportDropdown({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (p: Preset) => {
    setBusy(p.key);
    setError(null);
    setDoneUrl(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export-platform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ aspect: p.aspect, fit: 'blur-pad', subtitlePlatform: p.subtitlePlatform }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setDoneUrl(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5"
        title="导出到抖音/快手/小红书等平台版本"
      >
        <Share2 className="w-3.5 h-3.5" />
        平台导出
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-52 z-30 cinema-card-hi p-1.5 shadow-xl">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => run(p)}
              disabled={!!busy}
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-white/80 hover:bg-white/10 inline-flex items-center justify-between gap-2 disabled:opacity-40"
            >
              {p.label}
              {busy === p.key && <Loader2 className="w-3 h-3 animate-spin" />}
            </button>
          ))}
          {doneUrl && (
            <a
              href={doneUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 px-2.5 py-1.5 rounded-md text-[11px] text-emerald-400 hover:bg-emerald-500/10 inline-flex items-center gap-1.5"
            >
              <Check className="w-3 h-3" /> 导出完成 · 点击查看
            </a>
          )}
          {error && <div className="px-2.5 py-1.5 text-[11px] text-rose-400">✗ {error}</div>}
        </div>
      )}
    </div>
  );
}
