'use client';

/**
 * components/project/shot-cinematography-panel (v7.2)
 *
 * 单镜头电影摄影"驾驶舱控件" — 受控组件。对标 CineMaster/CineMatrix 的「单镜头精细化控制面板」:
 *   景别(分段按钮) · 机位(分段按钮) · 镜头(下拉) · 运镜(下拉) · 焦点(分段) · 氛围(chips) · 运动强度(滑块)
 *
 * 纯展示 + 受控: value / onChange, 不含持久化/网络 (交给上层 modal)。
 */

import {
  SHOT_SIZES, CAMERA_ANGLES, LENS_PRESETS, MOVEMENTS, FOCUS_PRESETS, ATMOSPHERES,
  type ShotSpec, type Preset,
} from '@/lib/cinematography';

function SegGroup<T extends string>({ list, value, onPick, title }: {
  list: Preset<T>[]; value: T; onPick: (id: T) => void; title: string;
}) {
  return (
    <div>
      <div className="cinema-eyebrow mb-1">{title}</div>
      <div className="flex flex-wrap gap-1">
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            title={p.label}
            className={`cinema-mono text-[10px] px-2 py-1 rounded-md border transition ${
              value === p.id
                ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-muted)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-hover)]'
            }`}
          >
            {p.short}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ShotCinematographyPanel({ value, onChange }: {
  value: ShotSpec;
  onChange: (next: ShotSpec) => void;
}) {
  const set = (patch: Partial<ShotSpec>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <SegGroup title="景别 SHOT SIZE" list={SHOT_SIZES} value={value.shotSize} onPick={(shotSize) => set({ shotSize })} />
      <SegGroup title="机位 ANGLE" list={CAMERA_ANGLES} value={value.angle} onPick={(angle) => set({ angle })} />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="cinema-eyebrow mb-1">镜头 LENS</div>
          <select className="cinema-input !py-1.5 !text-[11px] w-full" value={value.lens} onChange={(e) => set({ lens: e.target.value as any })}>
            {LENS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <div className="cinema-eyebrow mb-1">运镜 MOVEMENT</div>
          <select className="cinema-input !py-1.5 !text-[11px] w-full" value={value.movement} onChange={(e) => set({ movement: e.target.value as any })}>
            {MOVEMENTS.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.short}</option>)}
          </select>
        </div>
      </div>

      <SegGroup title="焦点 FOCUS" list={FOCUS_PRESETS} value={value.focus} onPick={(focus) => set({ focus })} />

      <div>
        <div className="cinema-eyebrow mb-1">氛围 ATMOSPHERE</div>
        <div className="flex flex-wrap gap-1">
          {ATMOSPHERES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => set({ atmosphere: p.id })}
              className={`text-[10px] px-2 py-1 rounded-full border transition ${
                value.atmosphere === p.id
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[rgba(90,143,204,0.12)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-hover)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="cinema-eyebrow mb-1 flex justify-between">
          运动强度 MOTION <span className="cinema-mono text-[var(--primary)]">{value.motion}</span>
        </label>
        <input
          type="range" min={0} max={100} value={value.motion}
          onChange={(e) => set({ motion: Number(e.target.value) })}
          className="w-full accent-[var(--primary)]"
        />
      </div>
    </div>
  );
}
