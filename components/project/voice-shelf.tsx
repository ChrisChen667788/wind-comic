'use client';

/**
 * v9.7.7 — 角色音色货架(阶段十六 · 音色手动覆盖)。列出全片角色 + 当前音色(覆盖 / 自动),
 * 下拉挑 `VOICE_CATALOG` 音色 + 「试听」(POST /api/voice-sample)+ 「保存」(POST /voice-overrides)。
 * 保存后 shot-audio 优先用覆盖音色。挂在「配音口型」面板内,默认折叠。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserSound, CaretDown, CaretRight, Play, CircleNotch, FloppyDisk } from '@phosphor-icons/react';
import { VOICE_CATALOG } from '@/lib/character-studio';
import { buildVoiceRouting } from '@/lib/voice-routing';

export function VoiceShelf({ projectId, characters }: { projectId: string; characters: string[] }) {
  const distinct = useMemo(() => Array.from(new Set(characters.map((c) => (c || '').trim()).filter(Boolean))), [characters]);
  const autoRouting = useMemo(() => buildVoiceRouting(distinct), [distinct]);
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [auditionId, setAuditionId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-overrides`);
        const b = await res.json();
        if (alive && res.ok && b.overrides) setOverrides(b.overrides);
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const voiceFor = useCallback((c: string) => overrides[c] || autoRouting.get(c) || 'narrator_male_cn', [overrides, autoRouting]);

  const audition = useCallback(async (c: string) => {
    setAuditionId(c); setSavedMsg(null);
    try {
      const res = await fetch('/api/voice-sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceId: voiceFor(c) }) });
      const b = await res.json();
      if (b.ok && b.audioUrl) { try { await new Audio(b.audioUrl).play(); } catch { /* 自动播放被拦 */ } }
      else setSavedMsg(b.message || '试听失败(需 TTS 引擎)');
    } catch (e) { setSavedMsg(e instanceof Error ? e.message : '试听失败'); }
    finally { setAuditionId(null); }
  }, [voiceFor]);

  const save = useCallback(async () => {
    setSaving(true); setSavedMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-overrides`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }),
      });
      const b = await res.json();
      setSavedMsg(b.ok ? '已保存 —— 下次「合成配音」按此音色' : (b.message || '保存失败'));
    } catch (e) { setSavedMsg(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  }, [projectId, overrides]);

  if (!distinct.length) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 mb-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 text-[11px] text-white/70">
        {open ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
        <UserSound className="w-3.5 h-3.5" /> 角色音色 · {distinct.length} 角色（手动挑 / 试听,覆盖自动路由）
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {distinct.map((c) => {
            const cur = voiceFor(c);
            const overridden = !!overrides[c];
            return (
              <div key={c} className="flex items-center gap-2">
                <span className="text-[11px] text-white/70 w-20 shrink-0 truncate">{c}</span>
                <select
                  value={cur}
                  onChange={(e) => setOverrides((m) => ({ ...m, [c]: e.target.value }))}
                  className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded px-1.5 py-1 text-[11px] text-white/80 outline-none"
                >
                  {VOICE_CATALOG.map((v) => (<option key={v.id} value={v.id} className="bg-[#1a1a24]">{v.label} · {v.tone}</option>))}
                </select>
                <span className={`text-[9px] shrink-0 w-6 ${overridden ? 'text-amber-300/70' : 'text-white/25'}`}>{overridden ? '手动' : '自动'}</span>
                <button onClick={() => audition(c)} disabled={!!auditionId} className="cinema-btn !px-1.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50" title="试听">
                  {auditionId === c ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="cinema-btn cinema-btn-primary !px-2.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50">
              {saving ? <CircleNotch className="w-3 h-3 animate-spin" /> : <FloppyDisk className="w-3 h-3" />}
              {saving ? '保存中…' : '保存音色'}
            </button>
            {savedMsg && <span className="text-[10px] text-white/45 truncate">{savedMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
