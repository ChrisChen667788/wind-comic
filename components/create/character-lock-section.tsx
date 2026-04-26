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
import { Upload, Link as LinkIcon, X, Loader2, UserCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast-provider';

export interface LockedCharacter {
  /** 角色名 — 必填(空字符串视为该槽位未启用) */
  name: string;
  /** 定位标签 — 决定 cw */
  role: 'lead' | 'antagonist' | 'supporting' | 'cameo';
  /** Midjourney --cw 值, 由 role 推导 */
  cw: number;
  /** persistAsset 后的稳定 URL */
  imageUrl: string;
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
          <UserCircle2 className="w-4 h-4 text-[#E8C547]" />
          <h3 className="text-sm font-semibold">角色锁脸 <span className="text-xs text-gray-500">(可选 · 最多 3 人)</span></h3>
        </div>
        <span className="text-[11px] text-gray-500">
          🔒 上传后,该角色在全片所有镜头里脸都会锁定
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
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const { showToast } = useToast();

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
    </div>
  );
}
