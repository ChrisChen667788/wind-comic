'use client';

/**
 * components/project/project-format-bar (v7.4) — 项目级格式条 (对标 CineFlow 顶栏)
 *
 * 画幅 / 色彩空间 / 帧率 / 安全框 一行控件 + 保存。落进 project_assets type='project-format'。
 */

import { useState } from 'react';
import { FloppyDisk as Save, CircleNotch as Loader2, Check, FilmSlate as Clapperboard } from '@phosphor-icons/react';
import {
  FORMAT_PRESETS, COLOR_SPACES, FRAME_RATES, normalizeProjectFormat, describeFormat,
  type ProjectFormat,
} from '@/lib/project-format';

export function ProjectFormatBar({ projectId, initialFormat, onSaved }: {
  projectId: string;
  initialFormat?: Partial<ProjectFormat>;
  onSaved?: (f: ProjectFormat) => void;
}) {
  const [f, setF] = useState<ProjectFormat>(() => normalizeProjectFormat(initialFormat));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<ProjectFormat>) => { setF((p) => ({ ...p, ...patch })); setSaved(false); };

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/format`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: f }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setSaved(true); onSaved?.(j.format || f); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  }

  return (
    <div className="cinema-card-hi !p-2.5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="cinema-eyebrow flex items-center gap-1.5 shrink-0"><Clapperboard size={13} className="text-[var(--primary)]" /> 项目格式</span>

      <label className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80">画幅
        <select className="cinema-input !py-1 !text-[11px] !w-auto" value={f.aspectId} onChange={(e) => set({ aspectId: e.target.value })}>
          {FORMAT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80">色彩
        <select className="cinema-input !py-1 !text-[11px] !w-auto" value={f.colorSpaceId} onChange={(e) => set({ colorSpaceId: e.target.value })}>
          {COLOR_SPACES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80">帧率
        <select className="cinema-input !py-1 !text-[11px] !w-auto" value={f.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
          {FRAME_RATES.map((r) => <option key={r} value={r}>{r >= 48 ? `${r}fps 升格` : `${r}fps`}</option>)}
        </select>
      </label>
      <button onClick={() => set({ safeArea: !f.safeArea })}
        className={`cinema-mono text-[10px] px-2 py-1 rounded border ${f.safeArea ? 'border-[var(--accent-green)] text-[var(--accent-green)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>
        安全框 {f.safeArea ? 'ON' : 'OFF'}
      </button>

      <button onClick={save} disabled={saving} className="cinema-btn-ghost !text-[11px] ml-auto disabled:opacity-50">
        {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} className="text-[var(--accent-green)]" /> : <Save size={12} />}
        {saved ? '已保存' : '保存格式'}
      </button>
    </div>
  );
}
