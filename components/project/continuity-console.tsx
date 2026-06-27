'use client';

/**
 * components/project/continuity-console (v7.3) — 连贯性 + 种子锁控制台 (对标 CineFlow Continuity Pro)
 *
 * 项目级"连贯性"驾驶舱:
 *   - 视觉基因库:角色锁定 (FaceID) / 环境锁定 / 种子锁定 (主+辅种子, 刷新)
 *   - 连贯性控制台:链接模式 (硬切/匹配切/参考上一帧) / 连贯性强度 / 服装锁 / 光照锁 / FaceID 强度
 *   - 分镜连贯性逻辑预览:每镜彩色 chips (角色/服装/环境/光照/连续/种子)
 *
 * 设置落进 project_assets type='continuity' (POST /api/projects/[id]/continuity)。
 */

import { useState } from 'react';
import { Lock, ArrowsClockwise as RefreshCw, FloppyDisk as Save, CircleNotch as Loader2, Users, Mountains as Mountain, Hash, LinkSimple as Link2, UserFocus as ScanFace, Check } from '@phosphor-icons/react';
import { EmptyState } from '@/components/cinema/primitives';
import {
  LINK_MODES, FACEID_STRENGTHS, generateSeed, normalizeContinuitySettings,
  computeContinuityTags, describeContinuity,
  type ContinuitySettings, type FaceIdStrength,
} from '@/lib/continuity';

const TAG_COLOR: Record<string, string> = {
  character: 'var(--cinema-amber)', clothing: 'var(--cinema-green)', environment: 'var(--cinema-blue)',
  lighting: 'var(--cinema-red)', time: 'var(--cinema-violet)', seed: 'var(--cinema-magenta)',
};

export function ContinuityConsole({
  projectId, characters = [], scenes = [], storyboards = [], initialSettings, onSaved,
}: {
  projectId: string;
  characters?: any[];
  scenes?: any[];
  storyboards?: any[];
  initialSettings?: Partial<ContinuitySettings>;
  onSaved?: (s: ContinuitySettings) => void;
}) {
  const [s, setS] = useState<ContinuitySettings>(() => normalizeContinuitySettings(initialSettings));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const set = (patch: Partial<ContinuitySettings>) => setS((prev) => ({ ...prev, ...patch }));

  const char0 = characters[0];
  const scene0 = scenes[0];
  const hasCharacter = characters.length > 0;
  const hasEnvironment = scenes.length > 0;

  async function save() {
    setSaving(true); setSavedMsg('');
    try {
      const r = await fetch(`/api/projects/${projectId}/continuity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: s }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setSavedMsg(j?.error || `保存失败 (${r.status})`);
      else { setSavedMsg('已保存连贯性设置'); onSaved?.(j.settings || s); setTimeout(() => setSavedMsg(''), 2500); }
    } catch (e: any) { setSavedMsg(e?.message || '网络错误'); }
    finally { setSaving(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
      {/* 左:视觉基因库 + 分镜连贯性预览 */}
      <div className="flex flex-col gap-4">
        <div className="cinema-card !p-4">
          <div className="cinema-eyebrow mb-3">视觉基因库 · VISUAL GENE LIBRARY</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 角色锁定 */}
            <div className="rounded-lg border border-[var(--cinema-border)] p-3">
              <div className="flex items-center gap-1.5 mb-2"><ScanFace size={13} className="text-[var(--cinema-amber)]" /><span className="text-[11px] font-semibold">角色锁定</span></div>
              {char0 ? (
                <>
                  <div className="cinema-mono text-[10px] opacity-70 truncate">{char0.name || 'CHAR-001'}</div>
                  <div className="cinema-mono text-[9px] opacity-50 mt-0.5">FaceID · {s.faceIdStrength.toUpperCase()}</div>
                  {characters.length > 1 && <div className="cinema-mono text-[9px] opacity-40 mt-0.5">+{characters.length - 1} 角色</div>}
                </>
              ) : <div className="cinema-mono text-[10px] opacity-40">无角色资产</div>}
            </div>
            {/* 环境锁定 */}
            <div className="rounded-lg border border-[var(--cinema-border)] p-3">
              <div className="flex items-center gap-1.5 mb-2"><Mountain size={13} className="text-[var(--cinema-blue)]" /><span className="text-[11px] font-semibold">环境锁定</span></div>
              {scene0 ? (
                <>
                  <div className="cinema-mono text-[10px] opacity-70 truncate">{scene0.name || 'ENV-001'}</div>
                  <div className="cinema-mono text-[9px] opacity-50 mt-0.5">{s.lightingLock ? '光照已锁' : '光照未锁'}</div>
                  {scenes.length > 1 && <div className="cinema-mono text-[9px] opacity-40 mt-0.5">+{scenes.length - 1} 场景</div>}
                </>
              ) : <div className="cinema-mono text-[10px] opacity-40">无场景资产</div>}
            </div>
            {/* 种子锁定 */}
            <div className="rounded-lg border border-[var(--cinema-border)] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5"><Hash size={13} className="text-[var(--cinema-magenta)]" /><span className="text-[11px] font-semibold">种子锁定</span></div>
                <button onClick={() => set({ mainSeed: generateSeed(), auxSeed: generateSeed() })} title="刷新种子" className="opacity-60 hover:opacity-100"><RefreshCw size={12} /></button>
              </div>
              <div className="cinema-mono text-sm text-[var(--cinema-amber)] tracking-wider">{s.mainSeed}</div>
              <div className="cinema-mono text-[9px] opacity-50 mt-0.5">辅种子 {s.auxSeed}</div>
            </div>
          </div>
        </div>

        {/* 分镜连贯性逻辑预览 */}
        <div className="cinema-card !p-4">
          <div className="cinema-eyebrow mb-3">分镜连贯性逻辑 · {storyboards.length} 镜</div>
          {storyboards.length === 0 && <EmptyState icon={Link2} title="暂无分镜" hint="生成分镜后,这里可设连续性 / 种子锁 / FaceID" />}
          <div className="flex flex-col gap-2">
            {storyboards.slice(0, 8).map((sb: any, i: number) => {
              const tags = computeContinuityTags(s, { hasCharacter, hasEnvironment, isFirstShot: i === 0 });
              return (
                <div key={sb.id || i} className="flex items-center gap-2 py-1.5 border-b border-[var(--cinema-border)] last:border-0">
                  <span className="cinema-mono text-[10px] opacity-60 w-12 shrink-0">SHOT {String(sb.shotNumber ?? i + 1).padStart(2, '0')}</span>
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <span key={t.id} className="text-[9px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: TAG_COLOR[t.id], color: TAG_COLOR[t.id] }}>{t.label}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {storyboards.length > 8 && <div className="cinema-mono text-[9px] opacity-40 mt-2">… 其余 {storyboards.length - 8} 镜同链路设置</div>}
        </div>
      </div>

      {/* 右:连贯性控制台 */}
      <aside className="cinema-card !p-4 h-fit">
        <div className="cinema-eyebrow mb-3 flex items-center gap-1.5"><Link2 size={13} /> 连贯性控制台</div>

        {/* 链接模式 */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold mb-1.5">链接模式 LINK MODE</div>
          <div className="flex flex-col gap-1">
            {LINK_MODES.map((m) => (
              <button key={m.id} onClick={() => set({ linkMode: m.id })}
                className={`text-left px-2.5 py-1.5 rounded-md border transition ${s.linkMode === m.id ? 'border-[var(--cinema-amber)] bg-[var(--cinema-amber-glow)]' : 'border-[var(--cinema-border)] hover:border-[var(--cinema-border-hi)]'}`}>
                <div className="text-[11px] font-semibold">{m.label} <span className="cinema-mono text-[9px] opacity-50">{m.en}</span></div>
                <div className="cinema-mono text-[9px] opacity-55">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 连贯性强度 */}
        <div className="mb-4">
          <label className="text-[11px] font-semibold mb-1 flex justify-between">连贯性强度 <span className="cinema-mono text-[var(--cinema-amber)]">{s.continuityStrength.toFixed(2)}</span></label>
          <input type="range" min={0} max={1} step={0.05} value={s.continuityStrength}
            onChange={(e) => set({ continuityStrength: Number(e.target.value) })} className="w-full accent-[var(--cinema-amber)]" />
          <div className="flex justify-between cinema-mono text-[9px] opacity-40"><span>0 松</span><span>1 严</span></div>
        </div>

        {/* 服装锁 / 光照锁 */}
        {([['clothingLock', '服装锁定'], ['lightingLock', '光照锁定']] as const).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between mb-2">
            <span className="text-[11px] flex items-center gap-1.5"><Lock size={11} className="opacity-50" />{label}</span>
            <button onClick={() => set({ [key]: !s[key] } as any)}
              className={`cinema-mono text-[10px] px-2 py-0.5 rounded border ${s[key] ? 'border-[var(--cinema-green)] text-[var(--cinema-green)]' : 'border-[var(--cinema-border)] text-[var(--cinema-text-3)]'}`}>
              {s[key] ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}

        {/* FaceID 强度 */}
        <div className="flex items-center justify-between mb-4 mt-2">
          <span className="text-[11px] flex items-center gap-1.5"><ScanFace size={12} className="opacity-50" />FaceID 强度</span>
          <select value={s.faceIdStrength} onChange={(e) => set({ faceIdStrength: e.target.value as FaceIdStrength })}
            className="cinema-input !py-1 !text-[11px] !w-auto">
            {FACEID_STRENGTHS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>

        <div className="cinema-mono text-[9px] opacity-50 mb-2 leading-relaxed border-t border-[var(--cinema-border)] pt-2">{describeContinuity(s)}</div>

        <button onClick={save} disabled={saving} className="cinema-btn-primary w-full justify-center !py-2.5 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存连贯性设置
        </button>
        {savedMsg && <p className="cinema-mono text-[10px] mt-1.5 text-center flex items-center justify-center gap-1 text-[var(--cinema-green)]"><Check size={11} />{savedMsg}</p>}
      </aside>
    </div>
  );
}
