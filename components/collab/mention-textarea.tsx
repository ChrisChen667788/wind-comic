'use client';

/**
 * v3.0 P0.1 — Textarea with @-mention autocomplete.
 *
 * 行为:
 *   - 用户输入 `@`, 之后追加字符时触发 /api/users/lookup?q=
 *   - 下拉显示 ≤10 名候选, ↑↓ 切换, Enter / Tab 选中, Esc 关闭
 *   - 选中后把当前 @prefix 替换成 `@FullName ` (尾空格让用户接着打字)
 *   - 没下拉时 textarea 行为完全正常 (Enter 不被吞)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { At as AtSign } from '@phosphor-icons/react';

interface UserHit {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MentionTextareaProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;             // ⌘/Ctrl + Enter
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** 自动获取焦点 */
  autoFocus?: boolean;
}

export function MentionTextarea({
  value, onChange, onSubmit, placeholder, rows = 3, disabled, autoFocus,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [hits, setHits] = useState<UserHit[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState<number | null>(null);

  // 根据 caret 位置回看当前 token, 判断是不是 @-prefix 模式
  const evalCaret = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? value.length;
    // 从 caret 往前找最近的 '@', 但中间不能有空白或换行
    const before = value.slice(0, pos);
    const m = /(^|[\s,，。、.;:!?])@([一-龥A-Za-z0-9_]{0,30})$/.exec(before);
    if (!m) {
      setOpen(false);
      setMentionStart(null);
      return;
    }
    const atIdx = pos - m[2].length - 1; // '@' 的位置
    setMentionStart(atIdx);
    const q = m[2];
    if (!q) {
      // 刚输入 '@' 还没字符 → 隐藏, 让用户继续打
      setOpen(false);
      setHits([]);
      return;
    }
    void doLookup(q);
  }, [value]);

  const doLookup = async (q: string) => {
    try {
      const res = await fetch(`/api/users/lookup?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      const list: UserHit[] = Array.isArray(body?.users) ? body.users : [];
      setHits(list);
      setActiveIdx(0);
      setOpen(list.length > 0);
    } catch {
      setHits([]);
      setOpen(false);
    }
  };

  const acceptHit = (hit: UserHit) => {
    const ta = textareaRef.current;
    if (!ta || mentionStart == null) return;
    const pos = ta.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(pos);
    const inserted = `@${hit.name} `;
    const next = before + inserted + after;
    onChange(next);
    setOpen(false);
    setHits([]);
    setMentionStart(null);
    // 把 caret 移到刚插入文本的末尾
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newPos = before.length + inserted.length;
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
        textareaRef.current.focus();
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && hits.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % hits.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + hits.length) % hits.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptHit(hits[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  // 每次 value/caret 变都重新评估
  useEffect(() => {
    if (!disabled) evalCaret();
  }, [value, evalCaret, disabled]);

  // autoFocus 仅初次挂载
  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={evalCaret}
        rows={rows}
        placeholder={placeholder || '写评论... 输入 @ 唤出选人. ⌘+Enter 发送.'}
        disabled={disabled}
        className="w-full px-3 py-2 cinema-mono text-[12px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded focus:outline-none focus:border-[var(--cinema-amber)] resize-y disabled:opacity-50"
      />
      {open && hits.length > 0 && (
        <div
          role="listbox"
          aria-label="提及用户候选"
          className="absolute z-30 left-0 bottom-full mb-1 w-72 max-h-60 overflow-y-auto bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] rounded shadow-2xl"
        >
          <div className="px-3 py-1.5 cinema-mono text-[10px] tracking-widest opacity-50 flex items-center gap-1">
            <AtSign className="w-2.5 h-2.5" />
            MENTION · {hits.length} 候选
          </div>
          {hits.map((h, i) => (
            <button
              key={h.id}
              type="button"
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                // mousedown 而不是 onclick — 避免 blur 先发生导致 acceptHit 时 textarea 失焦
                e.preventDefault();
                acceptHit(h);
              }}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${i === activeIdx ? 'bg-[var(--cinema-amber)]/10' : 'hover:bg-white/5'}`}
            >
              {h.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img loading="lazy" decoding="async" src={h.avatarUrl} alt={h.name} className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[var(--cinema-amber)]/30 grid place-items-center cinema-mono text-[9px]">
                  {h.name.slice(0, 1)}
                </div>
              )}
              <span className="cinema-mono text-[11px] flex-1 truncate">{h.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
