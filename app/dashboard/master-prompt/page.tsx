'use client';

/**
 * Master Prompt Generator · 顶级创意生成器 (v7.7) — 对标 CineMaster Pro
 *
 * 结构化生成 master prompt:Role / Task / 核心概念 + 执行参数(影片 look / LUT / 导演运镜 / 画幅 / 额外)。
 *   - 实时编译结构化 Markdown prompt
 *   - 复制 / LLM 优化 / 用此 prompt 去创作
 *   - 右下:专业术语对照表
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagicWand as Wand2, Copy, Check, Sparkle as Sparkles, CircleNotch as Loader2, ArrowRight, BookOpenText as BookText, FilmSlate as Clapperboard, FilmStrip as Film, Palette, Video } from '@phosphor-icons/react';
import {
  FILM_LOOK_PRESETS, LUT_PRESETS, MOVEMENT_STYLE_PRESETS, GLOSSARY,
  DEFAULT_MASTER_PROMPT, compileMasterPrompt, describeMasterPrompt,
  type MasterPromptSpec, type RefPreset,
} from '@/lib/master-prompt';

function PresetRow({ icon: Icon, title, list, value, onPick }: {
  icon: any; title: string; list: RefPreset[]; value: string; onPick: (id: string) => void;
}) {
  return (
    <div>
      <div className="cinema-eyebrow mb-1.5 flex items-center gap-1.5"><Icon size={12} /> {title}</div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((p) => (
          <button key={p.id} onClick={() => onPick(p.id)} title={p.ref}
            className={`text-left px-2 py-1 rounded-md border transition ${value === p.id ? 'border-[var(--cinema-amber)] bg-[var(--cinema-amber-glow)]' : 'border-[var(--cinema-border)] hover:border-[var(--cinema-border-hi)]'}`}>
            <span className="block text-[11px] leading-tight">{p.label}</span>
            <span className="block cinema-mono text-[9px] opacity-50">{p.ref}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MasterPromptPage() {
  const router = useRouter();
  const [spec, setSpec] = useState<MasterPromptSpec>(DEFAULT_MASTER_PROMPT);
  const [refined, setRefined] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const set = (patch: Partial<MasterPromptSpec>) => { setSpec((p) => ({ ...p, ...patch })); setRefined(null); };

  const compiled = compileMasterPrompt(spec);
  const shown = refined || compiled;

  function copy() {
    navigator.clipboard?.writeText(shown).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  async function refine() {
    setRefining(true); setErr('');
    try {
      const r = await fetch('/api/master-prompt/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: compiled }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j?.error || `优化失败 (${r.status})`);
      else setRefined(j.refined);
    } catch (e: any) { setErr(e?.message || '网络错误'); }
    finally { setRefining(false); }
  }

  function sendToCreate() {
    const seed = (spec.coreConcept.trim() || spec.task) + '\n\n[Master Prompt]\n' + shown;
    try { sessionStorage.setItem('qfmj-create-seed', seed); } catch { /* ignore */ }
    router.push('/dashboard/create');
  }

  return (
    <div className="cinema-page min-h-screen px-5 py-5 max-w-[1480px] mx-auto">
      <header className="mb-4">
        <div className="cinema-headline !text-xl flex items-center gap-2"><Wand2 size={20} className="text-[var(--cinema-amber)]" /> 顶级创意生成器</div>
        <div className="cinema-eyebrow !mt-1">MASTER PROMPT GENERATOR · 结构化导演级提示词</div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左:输入 + 预设 */}
        <div className="cinema-card !p-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2">
            <label className="cinema-eyebrow">Role · 角色设定
              <input className="cinema-input w-full mt-1 !text-xs" value={spec.role} onChange={(e) => set({ role: e.target.value })} />
            </label>
            <label className="cinema-eyebrow">Task · 任务
              <input className="cinema-input w-full mt-1 !text-xs" value={spec.task} onChange={(e) => set({ task: e.target.value })} />
            </label>
            <label className="cinema-eyebrow">Core Concept · 核心概念
              <textarea className="cinema-textarea w-full mt-1 !text-xs" rows={3} placeholder="本片的核心创意 / 情绪 / 卖点…"
                value={spec.coreConcept} onChange={(e) => set({ coreConcept: e.target.value })} />
            </label>
          </div>

          <PresetRow icon={Film} title="影片 LOOK · 光影参考" list={FILM_LOOK_PRESETS} value={spec.filmLook} onPick={(id) => set({ filmLook: id })} />
          <PresetRow icon={Palette} title="色彩 LUT" list={LUT_PRESETS} value={spec.lut} onPick={(id) => set({ lut: id })} />
          <PresetRow icon={Video} title="导演运镜风格" list={MOVEMENT_STYLE_PRESETS} value={spec.movementStyle} onPick={(id) => set({ movementStyle: id })} />

          <div className="grid grid-cols-2 gap-2">
            <label className="cinema-eyebrow">画幅
              <input className="cinema-input w-full mt-1 !text-xs" value={spec.aspect} onChange={(e) => set({ aspect: e.target.value })} />
            </label>
            <label className="cinema-eyebrow">额外参数
              <input className="cinema-input w-full mt-1 !text-xs" placeholder="可选" value={spec.extra} onChange={(e) => set({ extra: e.target.value })} />
            </label>
          </div>
        </div>

        {/* 右:编译结果 + 操作 + 术语表 */}
        <div className="flex flex-col gap-4">
          <div className="cinema-card !p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="cinema-eyebrow flex items-center gap-1.5"><Clapperboard size={13} className="text-[var(--cinema-amber)]" /> {refined ? '优化后 Prompt' : 'Master Prompt'}</span>
              <span className="cinema-mono text-[10px] opacity-60">{describeMasterPrompt(spec)}</span>
            </div>
            <pre className="cinema-mono text-[10px] leading-relaxed text-[var(--cinema-green)] bg-[var(--cinema-surface)] rounded-md p-3 max-h-[360px] overflow-auto custom-scrollbar whitespace-pre-wrap">{shown}</pre>
            {err && <p className="text-[var(--secondary)] text-xs mt-1.5">{err}</p>}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button onClick={copy} className="cinema-btn-ghost !text-[11px]">{copied ? <Check size={13} className="text-[var(--cinema-green)]" /> : <Copy size={13} />} 复制</button>
              <button onClick={refine} disabled={refining} className="cinema-btn-ghost !text-[11px] disabled:opacity-50">{refining ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 优化 Prompt</button>
              {refined && <button onClick={() => setRefined(null)} className="cinema-btn-ghost !text-[11px]">还原</button>}
              <button onClick={sendToCreate} className="cinema-btn-primary !text-[11px] ml-auto"><Sparkles size={13} /> 用此创作 <span className="cinema-cta-island"><ArrowRight size={12} /></span></button>
            </div>
          </div>

          {/* 专业术语对照表 */}
          <div className="cinema-card !p-4">
            <div className="cinema-eyebrow mb-2 flex items-center gap-1.5"><BookText size={13} /> 专业术语对照表</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {GLOSSARY.map((g) => (
                <div key={g.term} className="text-[11px] leading-snug">
                  <span className="cinema-mono text-[var(--cinema-amber)]">{g.term}</span>
                  {g.en && <span className="cinema-mono text-[9px] opacity-50"> {g.en}</span>}
                  <span className="opacity-80"> — {g.def}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
