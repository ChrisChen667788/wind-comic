'use client';

/**
 * v9.6.8 — 「存为模板」(阶段十六 T2)。把当前项目沉淀成可复用模板上架市场。
 * POST /api/projects/[id]/save-template(读画风/锁定角色/分镜/质量信号 → extractTemplate → 落库)。
 */
import { useState } from 'react';
import { Stack, CircleNotch } from '@phosphor-icons/react';

export function SaveTemplateButton({ projectId }: { projectId: string }) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const save = async () => {
    setSaving(true); setMsg(null); setErr(false);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/save-template`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg(`已上架模板「${body.template?.title}」(质量 ${body.template?.quality})— 去「模板市场」可一键复用`);
    } catch (e) {
      setErr(true); setMsg(e instanceof Error ? e.message : '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-white/70 min-w-0">
          <Stack className="w-4 h-4 shrink-0" />
          <span className="truncate">存为模板 · 把这个项目的画风 / 多参 / 节奏沉淀成可复用模板</span>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
        >
          {saving ? <CircleNotch className="w-3.5 h-3.5 animate-spin" /> : <Stack className="w-3.5 h-3.5" />}
          {saving ? '保存中…' : '存为模板'}
        </button>
      </div>
      {msg && <div className={`text-[11px] mt-2 ${err ? 'text-rose-400' : 'text-emerald-400'}`}>{msg}</div>}
    </div>
  );
}
