'use client';

/**
 * CharacterLockSection (v2.12 Phase 1)
 *
 * 创作工坊前置的"角色锁脸"区块 —— 让用户在创建项目前就能上传 1-3 个
 * 主要角色的脸照,确保全片这些角色长相统一。
 *
 * 单卡片字段:
 *   - 名称 (text)             — 例如"李长安"
 *   - 定位 (preset)           — 主角 / 对手 / 配角 / 客串 — 决定 cw
 *   - 头像 (file or URL)      — 本地上传 OR 直接贴外链
 *
 * Phase 1 行为说明:
 *   仅持久化数据;编排器只把 lockedCharacters[0] 拿去当全片 cameoFaceUrl
 *   (兜底现有单角色锁脸链路)。Phase 2 会做 per-shot 角色路由,根据
 *   Writer 标的角色名匹配对应的 cref。
 */

import { useEffect, useRef, useState } from 'react';
import { Upload, Link as LinkIcon, X, Loader2, UserCircle2, Sparkles } from 'lucide-react';
import { useToast } from '@/components/ui/toast-provider';
import type { CharacterTraits } from '@/lib/character-traits';

export interface LockedCharacter {
  /** 角色名 — 必填(空字符串视为该槽位未启用) */
  name: string;
  /** 定位标签 — 决定 cw */
  role: 'lead' | 'antagonist' | 'supporting' | 'cameo';
  /** Midjourney --cw 值, 由 role 推导 */
  cw: number;
  /** persistAsset 后的稳定 URL */
  imageUrl: string;
  /**
   * v2.12 Sprint A.2: 上传脸后自动调 /api/character-traits/from-face 反向抽到的 6-8 维档案。
   * confident=false 时前端给提示让用户检查;数据透传给 create-stream → orchestrator,
   * 编排器拼 prompt 时把这些维度合进 Character Bible,提升角色识别度与一致性。
   */
  traits?: CharacterTraits;
}

interface Props {
  value: LockedCharacter[];
  onChange: (next: LockedCharacter[]) => void;
}

const MAX_SLOTS = 3;

const ROLE_PRESETS: Array<{
  id: LockedCharacter['role'];
  label: string;
  cw: number;
  hint: string;
}> = [
  { id: 'lead',        label: '主角',  cw: 125, hint: '锁脸最强,出现在大多数镜头' },
  { id: 'antagonist',  label: '对手',  cw: 125, hint: '与主角对位的关键角色' },
  { id: 'supporting',  label: '配角',  cw: 100, hint: '次要角色,出现频率中等' },
  { id: 'cameo',       label: '客串',  cw:  80, hint: '只在 1-2 个镜头里出现' },
];

const DEFAULT_SLOT: LockedCharacter = { name: '', role: 'lead', cw: 125, imageUrl: '' };

export function CharacterLockSection({ value, onChange }: Props) {
  // 始终内部维持 3 个槽位;onChange 时过滤掉空的(name 或 imageUrl 缺失)
  const [slots, setSlots] = useState<LockedCharacter[]>(() => {
    const padded = [...value];
    while (padded.length < MAX_SLOTS) padded.push({ ...DEFAULT_SLOT });
    return padded.slice(0, MAX_SLOTS);
  });

  // 当外部 value 变化时同步(例如 reset 后)
  useEffect(() => {
    const padded = [...value];
    while (padded.length < MAX_SLOTS) padded.push({ ...DEFAULT_SLOT });
    setSlots(padded.slice(0, MAX_SLOTS));
  }, [value.length]); // 只看长度避免循环

  const updateSlot = (idx: number, patch: Partial<LockedCharacter>) => {
    setSlots(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // role 变了 → cw 跟着变(除非用户已手动覆盖,Phase 1 不暴露手动 cw)
      if (patch.role) {
        const preset = ROLE_PRESETS.find(p => p.id === patch.role);
        if (preset) next[idx].cw = preset.cw;
      }
      // 通知父组件
      onChange(next.filter(s => s.name.trim() && s.imageUrl));
      return next;
    });
  };

  const clearSlot = (idx: number) => {
    updateSlot(idx, { name: '', imageUrl: '' });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <UserCircle2 className="w-3.5 h-3.5 text-[#E8C547] cinema-page:text-[var(--cinema-amber)]" />
          {/* 同时兼容旧/新主题: cinema-page 内显示 mono eyebrow, 否则显示原 h3 */}
          <span className="cinema-eyebrow tracking-widest hidden [.cinema-page_&]:inline">CAMEO LOCK · 角色锁脸</span>
          <h3 className="text-sm font-semibold [.cinema-page_&]:hidden">
            角色锁脸 <span className="text-xs text-gray-500">(可选 · 最多 3 人)</span>
          </h3>
        </div>
        <span className="text-[11px] text-gray-500 [.cinema-page_&]:cinema-mono [.cinema-page_&]:tracking-wider">
          <span className="[.cinema-page_&]:hidden">🔒 上传后,该角色在全片所有镜头里脸都会锁定</span>
          <span className="hidden [.cinema-page_&]:inline opacity-60">UP TO 3 · 全片锁脸</span>
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {slots.map((slot, idx) => (
          <CharacterCard
            key={idx}
            slotLabel={String.fromCharCode(65 + idx) /* A / B / C */}
            slot={slot}
            onUpdate={patch => updateSlot(idx, patch)}
            onClear={() => clearSlot(idx)}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

interface CardProps {
  slotLabel: string;
  slot: LockedCharacter;
  onUpdate: (patch: Partial<LockedCharacter>) => void;
  onClear: () => void;
}

function CharacterCard({ slotLabel, slot, onUpdate, onClear }: CardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const { showToast } = useToast();

  // v2.12 Sprint A.3: Bible 跨项目复用查询(debounced)
  const [bibleHit, setBibleHit] = useState<{
    bible: {
      role: LockedCharacter['role'];
      cw: number;
      imageUrl: string;
      traits?: CharacterTraits | null;
      sampleFaces?: string[];
    };
    usedInProjectsCount: number;
  } | null>(null);
  const [bibleDismissed, setBibleDismissed] = useState(false);

  useEffect(() => {
    // 已经有头像或者用户已经 dismiss 过 → 不再 lookup
    if (slot.imageUrl || bibleDismissed) {
      setBibleHit(null);
      return;
    }
    const trimmed = slot.name.trim();
    if (trimmed.length < 2) {
      setBibleHit(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/characters/bible/${encodeURIComponent(trimmed)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const json = await res.json();
        if (json && json.found) {
          setBibleHit({ bible: json.bible, usedInProjectsCount: json.usedInProjectsCount });
        } else {
          setBibleHit(null);
        }
      } catch { /* abort/network — silent */ }
    }, 600);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [slot.name, slot.imageUrl, bibleDismissed]);

  const reuseBible = () => {
    if (!bibleHit) return;
    onUpdate({
      role: bibleHit.bible.role,
      cw: bibleHit.bible.cw,
      imageUrl: bibleHit.bible.imageUrl,
      traits: bibleHit.bible.traits ?? undefined,
    });
    setBibleHit(null);
    showToast({ title: `已复用「${slot.name}」的历史档案`, type: 'success' });
  };

  /**
   * v2.12 Sprint A.2: 上传成功后 fire-and-forget 调 GPT-4o Vision,
   * 反向抽 6-8 维档案,展示成 chips。失败静默(不打断主流程,只是没 chips)。
   */
  const extractTraits = async (imageUrl: string) => {
    setExtracting(true);
    try {
      const res = await fetch('/api/character-traits/from-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, defaultName: slot.name || undefined }),
      });
      if (res.ok) {
        const traits: CharacterTraits = await res.json();
        onUpdate({ traits });
        if (traits.confident === false) {
          showToast({ title: '自动识别置信度低,可手动调整', type: 'info' });
        }
      }
    } catch {
      /* 静默 — 即使 vision 挂了用户仍然能继续创作,只是没自动 6 维档案 */
    } finally {
      setExtracting(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast({ title: '只能上传图片', type: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast({ title: '图片太大(上限 10MB)', type: 'error' });
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/character-face', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) {
        showToast({ title: body.error || '上传失败', type: 'error' });
        return;
      }
      onUpdate({ imageUrl: body.url });
      extractTraits(body.url);
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : '上传失败', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      showToast({ title: 'URL 必须以 http:// 或 https:// 开头', type: 'error' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/upload/character-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast({ title: body.error || 'URL 抓取失败', type: 'error' });
        return;
      }
      onUpdate({ imageUrl: body.url });
      setShowUrlInput(false);
      setUrlDraft('');
      extractTraits(body.url);
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : 'URL 抓取失败', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const hasImage = !!slot.imageUrl;

  return (
    <div className={`relative rounded-2xl border p-3 transition ${
      hasImage
        ? 'border-[#E8C547]/35 bg-[#E8C547]/5'
        : 'border-dashed border-white/15 bg-white/[0.02]'
    }`}>
      {/* 槽位徽章 */}
      <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-[#E8C547] text-black text-[11px] font-bold flex items-center justify-center shadow">
        {slotLabel}
      </div>

      {/* v2.12 Sprint A.3: 历史 Bible 命中提示 */}
      {bibleHit && !hasImage && (
        <div className="mb-2 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 text-[10.5px]">
          <img
            src={bibleHit.bible.imageUrl}
            alt=""
            className="w-7 h-7 rounded-md object-cover flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-emerald-200 font-semibold truncate">
              📚 已找到「{slot.name.trim()}」
            </div>
            <div className="text-emerald-200/60 text-[9.5px]">
              {bibleHit.usedInProjectsCount} 个历史项目用过
            </div>
          </div>
          <button
            type="button"
            onClick={reuseBible}
            className="px-2 py-0.5 rounded bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-100 text-[10px] font-medium flex-shrink-0"
          >
            一键复用
          </button>
          <button
            type="button"
            onClick={() => setBibleDismissed(true)}
            className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white flex-shrink-0"
            aria-label="dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 图片预览 / 上传区 */}
      <div className="flex items-start gap-3">
        <div
          onClick={() => !busy && !hasImage && inputRef.current?.click()}
          className={`relative w-16 h-16 rounded-xl flex-shrink-0 overflow-hidden ${
            !hasImage ? 'cursor-pointer hover:bg-white/10 bg-white/5' : ''
          } flex items-center justify-center`}
        >
          {busy ? (
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          ) : hasImage ? (
            <img src={slot.imageUrl} alt={slot.name || `角色 ${slotLabel}`} className="w-full h-full object-cover" />
          ) : (
            <Upload className="w-5 h-5 text-gray-500" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={slot.name}
            onChange={e => onUpdate({ name: e.target.value })}
            placeholder="角色名(例如 李长安)"
            className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-md focus:outline-none focus:border-[#E8C547]/50"
          />
          <select
            value={slot.role}
            onChange={e => onUpdate({ role: e.target.value as LockedCharacter['role'] })}
            className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-md focus:outline-none focus:border-[#E8C547]/50"
          >
            {ROLE_PRESETS.map(p => (
              <option key={p.id} value={p.id}>
                {p.label} · cw={p.cw}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 操作行 */}
      <div className="mt-3 flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        {!hasImage && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex-1 px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Upload className="w-3 h-3" />
              上传文件
            </button>
            <button
              type="button"
              onClick={() => setShowUrlInput(v => !v)}
              disabled={busy}
              className="flex-1 px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <LinkIcon className="w-3 h-3" />
              用 URL
            </button>
          </>
        )}
        {hasImage && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="px-2 py-1 text-[11px] rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
          >
            <X className="w-3 h-3" />
            清除
          </button>
        )}
      </div>

      {showUrlInput && !hasImage && (
        <div className="mt-2 flex gap-1">
          <input
            type="url"
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleUrl(); }}
            placeholder="https://..."
            className="flex-1 px-2 py-1 text-[11px] bg-black/30 border border-white/10 rounded focus:outline-none focus:border-[#E8C547]/50"
          />
          <button
            type="button"
            onClick={handleUrl}
            disabled={busy || !urlDraft.trim()}
            className="px-2 py-1 text-[11px] rounded bg-[#E8C547]/15 text-[#E8C547] hover:bg-[#E8C547]/25 disabled:opacity-40"
          >
            抓取
          </button>
        </div>
      )}

      {/* v2.12 Sprint A.2: 自动抽到的 6 维档案 chips */}
      {hasImage && (extracting || slot.traits) && (
        <TraitChips traits={slot.traits} extracting={extracting} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TraitChips — 反向抽取出的 6-8 维档案 chips
// ─────────────────────────────────────────────────────────────────────

function TraitChips({
  traits,
  extracting,
}: {
  traits?: CharacterTraits;
  extracting: boolean;
}) {
  if (extracting) {
    return (
      <div className="mt-2.5 pt-2 border-t border-white/8 flex items-center gap-1.5 text-[10.5px] text-violet-300/80">
        <Sparkles className="w-3 h-3 animate-pulse" />
        <span>AI 正在从这张脸抽取角色档案...</span>
      </div>
    );
  }

  if (!traits) return null;

  // gender 映射成中文,只显示有真实信息的维度
  const genderText = traits.gender === 'male' ? '男' : traits.gender === 'female' ? '女' : null;
  const chips: Array<{ label: string; full?: string }> = [];
  if (genderText) chips.push({ label: genderText });
  if (traits.ageGroup && traits.ageGroup !== '未明示') chips.push({ label: traits.ageGroup });
  if (traits.skinTone && traits.skinTone !== '未明示') chips.push({ label: traits.skinTone });
  if (traits.appearance && traits.appearance !== '未明示') {
    chips.push({ label: traits.appearance.length > 8 ? traits.appearance.slice(0, 8) + '…' : traits.appearance, full: traits.appearance });
  }
  if (traits.costume && traits.costume !== '未明示') {
    chips.push({ label: traits.costume.length > 8 ? traits.costume.slice(0, 8) + '…' : traits.costume, full: traits.costume });
  }
  if (traits.personality && traits.personality !== '未明示') {
    chips.push({ label: traits.personality.length > 8 ? traits.personality.slice(0, 8) + '…' : traits.personality, full: traits.personality });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-2.5 pt-2 border-t border-white/8">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-widest text-violet-300/70 mb-1.5">
        <Sparkles className="w-2.5 h-2.5" />
        <span>AI 抽取档案</span>
        {traits.confident === false && (
          <span className="ml-1 px-1 rounded bg-amber-500/15 text-amber-300 normal-case tracking-normal text-[9px]">置信度低</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.map((c, i) => (
          <span
            key={i}
            title={c.full}
            className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-200/85 text-[10.5px] border border-violet-500/20"
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
