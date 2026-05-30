'use client';

/**
 * v6.1.1 — 智能提示词编辑器 (Prompt IDE UI).
 *
 * textarea + `@` 引用自动补全下拉 + 编译预览. 纯逻辑全在 lib/prompt-ide (已单测),
 * 这里只做交互 (光标追踪 / 下拉 / 键盘导航 / 回填). 资产来自 /api/prompt-ide/assets.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { At as AtSign, Eye, EyeSlash as EyeOff, X } from '@phosphor-icons/react';
import {
  activeMention, suggestAssets, insertMention, compilePrompt,
  type MentionableAsset,
} from '@/lib/prompt-ide';

const KIND_LABEL: Record<MentionableAsset['kind'], string> = {
  character: '角色', scene: '场景', style: '风格', prop: '道具',
};
const KIND_COLOR: Record<MentionableAsset['kind'], string> = {
  character: 'text-amber-300 bg-amber-500/15 border-amber-500/25',
  scene: 'text-sky-300 bg-sky-500/15 border-sky-500/25',
  style: 'text-violet-300 bg-violet-500/15 border-violet-500/25',
  prop: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25',
};

export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows = 10,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [assets, setAssets] = useState<MentionableAsset[]>([]);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  // 拉可引用资产 (失败静默 — 编辑器仍可当普通 textarea 用)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/prompt-ide/assets')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d?.assets)) setAssets(d.assets); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 选中插入后恢复光标
  useEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      taRef.current.focus();
      taRef.current.setSelectionRange(pos, pos);
      setCaret(pos);
    }
  }, [value]);

  const active = open ? activeMention(value, caret) : null;
  const suggestions = active ? suggestAssets(active.name, assets, 8) : [];
  const dropdownVisible = open && active != null && suggestions.length > 0;

  const syncCaret = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    setCaret(pos);
    const am = activeMention(el.value, pos);
    setOpen(am != null);
    setHighlight(0);
  }, []);

  const pick = useCallback((asset: MentionableAsset) => {
    const el = taRef.current;
    const pos = el?.selectionStart ?? caret;
    const am = activeMention(value, pos);
    if (!am) return;
    const { text, caret: newCaret } = insertMention(value, am, asset.name);
    pendingCaret.current = newCaret;
    setOpen(false);
    onChange(text);
  }, [value, caret, onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!dropdownVisible) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[highlight]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  const compiled = showPreview ? compilePrompt(value, assets) : null;

  return (
    <div className="relative">
      <div className="relative">
        <textarea
          ref={taRef}
          value={value}
          placeholder={placeholder}
          rows={rows}
          onChange={(e) => { onChange(e.target.value); }}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className={className}
        />

        {/* @ 补全下拉 */}
        {dropdownVisible && (
          <div className="absolute left-3 right-3 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/15 bg-[rgba(20,20,24,0.98)] backdrop-blur-xl shadow-2xl">
            <div className="px-3 py-1.5 text-[10px] text-gray-500 border-b border-white/5 flex items-center gap-1">
              <AtSign className="w-3 h-3" /> 引用资产 · ↑↓ 选择 · Enter 确认 · Esc 关闭
            </div>
            {suggestions.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(a); }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${i === highlight ? 'bg-white/10' : 'hover:bg-white/5'}`}
              >
                <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[10px] border ${KIND_COLOR[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                <span className="text-sm text-white truncate">{a.name}</span>
                <span className="text-[11px] text-gray-500 truncate ml-auto max-w-[45%]">{a.expansion}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 工具条: 提示 + 预览开关 */}
      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-gray-500 flex items-center gap-1">
          <AtSign className="w-3 h-3" /> 输入 @ 引用角色 / 场景 / 风格资产{assets.length > 0 ? `(${assets.length} 个可用)` : ''}
        </span>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="inline-flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
        >
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPreview ? '收起编译预览' : '编译预览'}
        </button>
      </div>

      {/* 编译预览面板 */}
      {compiled && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px]">
          <p className="text-[10px] text-gray-500 mb-1.5">编译后 prompt(@引用已展开,交给图像引擎的实际文本)</p>
          <p className="text-gray-200 leading-relaxed whitespace-pre-wrap break-words">{compiled.prompt || <span className="text-gray-600">（空）</span>}</p>
          {compiled.used.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {compiled.used.map((a) => (
                <span key={a.id} className={`px-1.5 py-0.5 rounded-md text-[10px] border ${KIND_COLOR[a.kind]}`}>
                  {KIND_LABEL[a.kind]} {a.name}
                </span>
              ))}
            </div>
          )}
          {compiled.unresolved.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-300/90 flex items-start gap-1">
              <X className="w-3 h-3 mt-0.5 shrink-0" />
              未匹配引用(将按裸名输出,建议先在角色库/资产库创建):{compiled.unresolved.join('、')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
