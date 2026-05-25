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
  LIGHTING_SETUPS, CONTRAST_LEVELS, COLOR_TEMPS, CAMERA_BODIES, LENS_SERIES,
  T_STOPS, ISO_OPTIONS, ND_OPTIONS, WB_PRESETS,
  type ShotSpec, type Preset, type LightingSpec, type CameraSimSpec,
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
  const setLight = (patch: Partial<LightingSpec>) => onChange({ ...value, lighting: { ...value.lighting, ...patch } });
  const setCam = (patch: Partial<CameraSimSpec>) => onChange({ ...value, camera: { ...value.camera, ...patch } });

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

      {/* v7.4 光影设计 + 摄影机/镜头模拟 (折叠, 高级) */}
      <details className="rounded-lg border border-[var(--border)] p-2.5 [&_summary]:cursor-pointer">
        <summary className="cinema-eyebrow !mb-0 select-none">光影 + 摄影机模拟 · 高级</summary>
        <div className="flex flex-col gap-3 mt-3">
          {/* 光影 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <div className="cinema-eyebrow mb-1">光影 LIGHTING</div>
              <select className="cinema-input !py-1.5 !text-[11px] w-full" value={value.lighting.setup}
                onChange={(e) => setLight({ setup: e.target.value as any })}>
                {LIGHTING_SETUPS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <div className="cinema-eyebrow mb-1">色温 K</div>
              <select className="cinema-input !py-1.5 !text-[11px] w-full" value={value.lighting.keyTempK}
                onChange={(e) => setLight({ keyTempK: Number(e.target.value) })}>
                {COLOR_TEMPS.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <div className="cinema-eyebrow mb-1">反差</div>
              <div className="flex gap-0.5">
                {CONTRAST_LEVELS.map((c) => (
                  <button key={c.id} type="button" onClick={() => setLight({ contrast: c.id })}
                    className={`flex-1 cinema-mono text-[10px] py-1.5 rounded border transition ${value.lighting.contrast === c.id ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-muted)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>
                    {c.label.replace('反差', '')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 摄影机 / 镜头 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="cinema-eyebrow mb-1">机身 BODY</div>
              <select className="cinema-input !py-1.5 !text-[11px] w-full" value={value.camera.body} onChange={(e) => setCam({ body: e.target.value as any })}>
                {CAMERA_BODIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <div className="cinema-eyebrow mb-1">镜头系列 LENS</div>
              <select className="cinema-input !py-1.5 !text-[11px] w-full" value={value.camera.lensSeries} onChange={(e) => setCam({ lensSeries: e.target.value as any })}>
                {LENS_SERIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 col-span-2 gap-2">
              <label className="cinema-mono text-[10px] opacity-70">T-Stop
                <select className="cinema-input !py-1 !text-[11px] w-full mt-0.5" value={value.camera.tStop} onChange={(e) => setCam({ tStop: Number(e.target.value) })}>
                  {T_STOPS.map((t) => <option key={t} value={t}>T{t}</option>)}
                </select>
              </label>
              <label className="cinema-mono text-[10px] opacity-70">ISO
                <select className="cinema-input !py-1 !text-[11px] w-full mt-0.5" value={value.camera.iso} onChange={(e) => setCam({ iso: Number(e.target.value) })}>
                  {ISO_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </label>
              <label className="cinema-mono text-[10px] opacity-70">ND
                <select className="cinema-input !py-1 !text-[11px] w-full mt-0.5" value={value.camera.nd} onChange={(e) => setCam({ nd: e.target.value })}>
                  {ND_OPTIONS.map((n) => <option key={n} value={n}>{n === 'none' ? '无' : n}</option>)}
                </select>
              </label>
              <label className="cinema-mono text-[10px] opacity-70">白平衡 WB
                <select className="cinema-input !py-1 !text-[11px] w-full mt-0.5" value={value.camera.wb} onChange={(e) => setCam({ wb: Number(e.target.value) })}>
                  {WB_PRESETS.map((w) => <option key={w} value={w}>{w}K</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
