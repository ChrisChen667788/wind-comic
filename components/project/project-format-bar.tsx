'use client';

/**
 * components/project/project-format-bar (v7.4) — 项目级格式条 (对标 CineFlow 顶栏)
 *
 * 画幅 / 色彩空间 / 帧率 / 安全框 一行控件 + 保存。落进 project_assets type='project-format'。
 *
 * v12.464:画幅改为**只读显示 `projects.aspect`**(项目详情接口的 `aspect`)。修前这里是一个
 * 默认 Scope 2.39:1 的下拉框,存进 project-format 资产却没有任何生成代码读它 —— 9:16 项目
 * 也显示 Scope,改了也不生效。画幅在创建时定下,出片、分镜构图、导演台都按 `projects.aspect` 算;
 * 这里不给改,因为改了既不会重排已出的素材,单镜重生也不读它,只会把「改了没用」换个地方再演一遍。
 */

import { useState } from 'react';
import { FloppyDisk as Save, CircleNotch as Loader2, Check, FilmSlate as Clapperboard, LockSimple as Lock } from '@phosphor-icons/react';
import {
  COLOR_SPACES, FRAME_RATES, normalizeProjectFormat, describeProjectAspect,
  type ProjectFormat,
} from '@/lib/project-format';

const ASPECT_HINT = '画幅在创建项目时确定,出片、分镜构图、导演台都按它算,这里只显示。'
  + '要另一比例的成片:「分发」页「改画幅 · 一片两投」直接重构图;要按新画幅重新出片:用新画幅重新创建。';

export function ProjectFormatBar({ projectId, aspect, initialFormat, onSaved }: {
  projectId: string;
  /** 项目画幅(`projects.aspect`,项目详情接口的 `aspect`) */
  aspect?: string | null;
  initialFormat?: Partial<ProjectFormat>;
  onSaved?: (f: ProjectFormat) => void;
}) {
  const a = describeProjectAspect(aspect);
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

      <span className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80" title={ASPECT_HINT}>画幅
        <span data-testid="format-aspect" className="cinema-input !py-1 !text-[11px] !w-auto flex items-center gap-1">
          <Lock size={10} className="opacity-50" />{a.label}
        </span>
        {!a.engineReady && (
          <span data-testid="format-aspect-warn" className="text-[var(--cinema-amber)]"
            title="视频引擎只出 16:9 / 9:16 / 1:1">视频引擎不支持此画幅</span>
        )}
      </span>
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
