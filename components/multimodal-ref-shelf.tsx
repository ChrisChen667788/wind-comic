'use client';

/**
 * v6.1.2 — 多模态参考货架. 让用户在创作前挂 图/音/视频 参考 (文件或 URL).
 * v9.4.6 (对标可灵 Elements): 升级成「多参元素货架」—— 每个参考可标结构化元素角色
 * (角色/风格/场景/道具/运镜/音色), 经 lib/reference-elements 路由进 cref/sref/DNA 一致性管线,
 * 并给「元素完整度」引导。纯逻辑在 lib/multimodal-ref + lib/reference-elements (已单测).
 */

import { useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { Image as ImageIcon, MusicNotes as Music, Video, Plus, X, Paperclip } from '@phosphor-icons/react';
import {
  classifyRef, validateRefs, ACCEPT_ATTR, KIND_LABEL, MAX_PER_KIND,
  type ReferenceAsset, type RefKind,
} from '@/lib/multimodal-ref';
import {
  ELEMENT_ROLE_LABEL, inferElementRole, elementCompleteness, clampElementWeight,
  ELEMENT_WEIGHT_MIN, ELEMENT_WEIGHT_MAX, ELEMENT_WEIGHT_DEFAULT,
  type ElementRole, type ReferenceElement,
} from '@/lib/reference-elements';

const KIND_ICON: Record<RefKind, typeof ImageIcon> = { image: ImageIcon, audio: Music, video: Video };
const ELEMENT_ROLES = Object.keys(ELEMENT_ROLE_LABEL) as ElementRole[];

export function MultimodalRefShelf({
  refs,
  onChange,
}: {
  refs: ReferenceAsset[];
  onChange: (refs: ReferenceAsset[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [err, setErr] = useState('');

  const elements = refs as ReferenceElement[];

  const apply = (next: ReferenceAsset[]) => {
    const v = validateRefs(next);
    setErr(v.ok ? '' : v.errors[0]);
    onChange(next);
  };

  const setRole = (id: string, role: ElementRole) =>
    apply(elements.map((r) => (r.id === id ? { ...r, elementRole: role } : r)));

  // v9.4.9: 角色元素强度(cref cw)
  const setWeight = (id: string, weight: number) =>
    apply(elements.map((r) => (r.id === id ? { ...r, weight: clampElementWeight(weight) } : r)));

  const addFromFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr('');
    const additions: ReferenceAsset[] = [];
    for (const f of Array.from(files)) {
      const kind = classifyRef({ mime: f.type, name: f.name });
      if (!kind) { setErr(`不支持的文件类型:${f.name}`); continue; }
      if (f.size > 25 * 1024 * 1024) { setErr(`${f.name} 超过 25MB,请用 URL 引用`); continue; }
      try {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        additions.push({ id: nanoid(), kind, url: dataUrl, name: f.name });
      } catch { setErr(`读取失败:${f.name}`); }
    }
    if (additions.length) apply([...refs, ...additions]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const addFromUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    const kind = classifyRef({ url });
    if (!kind) { setErr('无法识别该 URL 的媒体类型(需 图 / 音 / 视频)'); return; }
    apply([...refs, { id: nanoid(), kind, url, name: url.split('/').pop()?.split('?')[0] || url }]);
    setUrlInput('');
  };

  const remove = (id: string) => apply(refs.filter((r) => r.id !== id));

  const completeness = elements.length > 0 ? elementCompleteness(elements) : null;
  const barColor = completeness
    ? completeness.level === 'rich' ? 'bg-emerald-500' : completeness.level === 'good' ? 'bg-sky-500' : 'bg-amber-500'
    : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-[#E8C547]" />
          多参元素(可选)
          <span className="px-2 py-0.5 bg-[#E8C547]/10 text-[#E8C547] text-xs rounded-full">按角色锁一致性</span>
        </label>
        <span className="text-xs text-gray-400">图 {MAX_PER_KIND.image} · 音 {MAX_PER_KIND.audio} · 视频 {MAX_PER_KIND.video}</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10 transition-all inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> 上传文件
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT_ATTR} multiple className="hidden" onChange={(e) => addFromFiles(e.target.files)} />
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFromUrl())}
          placeholder="或粘贴 图/音/视频 链接后回车"
          className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-[#E8C547]/40 transition-all"
        />
      </div>

      {err && <p className="mt-1.5 text-[11px] text-amber-300/90">{err}</p>}

      {elements.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {elements.map((r) => {
            const Icon = KIND_ICON[r.kind];
            const role = r.elementRole ?? inferElementRole(r);
            return (
              <div key={r.id} className="relative group w-20">
                <div className="w-20 h-20 rounded-lg border border-white/10 bg-black/40 overflow-hidden flex items-center justify-center">
                  {r.kind === 'image' ? (
                    <img src={r.url} alt={r.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <Icon className="w-7 h-7 text-gray-400" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="移除参考"
                >
                  <X className="w-3 h-3" />
                </button>
                {/* v9.4.6: 元素角色 — 决定该参考路由进 cref/sref/DNA 的哪一路 */}
                <select
                  value={role}
                  onChange={(e) => setRole(r.id, e.target.value as ElementRole)}
                  title={`元素角色 · ${r.name}`}
                  className="mt-1 w-20 bg-black/60 border border-white/10 rounded text-[10px] text-gray-200 px-1 py-0.5 focus:outline-none focus:border-[#E8C547]/40 cursor-pointer"
                >
                  {ELEMENT_ROLES.map((er) => (
                    <option key={er} value={er}>{ELEMENT_ROLE_LABEL[er]}</option>
                  ))}
                </select>
                {/* v9.4.9: 角色元素强度 (cref cw, 越大越锁脸) */}
                {role === 'character' && (
                  <div className="mt-1 flex items-center gap-1" title="角色强度 cw(25-125,越大越锁脸)">
                    <span className="text-[9px] text-gray-500 shrink-0">cw</span>
                    <input
                      type="range" min={ELEMENT_WEIGHT_MIN} max={ELEMENT_WEIGHT_MAX} step={5}
                      value={r.weight ?? ELEMENT_WEIGHT_DEFAULT}
                      onChange={(e) => setWeight(r.id, Number(e.target.value))}
                      className="w-10 h-1 accent-[#E8C547] cursor-pointer"
                    />
                    <span className="text-[9px] text-gray-300 tabular-nums w-5 text-right">{r.weight ?? ELEMENT_WEIGHT_DEFAULT}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* v9.4.6: 元素完整度引导 (可灵式「加元素」, 落到我们的 DNA/cref/sref 能力) */}
      {completeness && (
        <div className="mt-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-400">元素完整度</span>
            <span className="text-[11px] font-medium text-gray-300 tabular-nums">{completeness.score}%</span>
          </div>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${completeness.score}%` }} />
          </div>
          <p className="mt-1.5 text-[10px] text-gray-500">{completeness.hints[0]}</p>
        </div>
      )}
    </div>
  );
}
