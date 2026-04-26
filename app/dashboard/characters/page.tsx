'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Users, Plus, X, Clipboard, Check, Tag, Eye, Trash2, Search, Wand2, Loader2, Sparkles,
} from 'lucide-react';

interface CharacterItem {
  id: string;
  userId: string;
  name: string;
  description: string;
  appearance: string;
  visualTags: string[];
  imageUrls: string[];
  styleKeywords: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Save Character Modal ────────────────────────────────────────────────────

function SaveCharacterModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (character: CharacterItem) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appearance, setAppearance] = useState('');
  const [styleKeywords, setStyleKeywords] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [visualTags, setVisualTags] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Sprint A.2: 反向抽取状态
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillMsg, setAutoFillMsg] = useState<string>('');
  const [autoFilledFlag, setAutoFilledFlag] = useState(false);

  /**
   * Sprint A.2 · 用第一张参考图反向抽取 6-8 维角色档案, 自动填表。
   * 用户可在抽取结果上继续微调, 不强行覆盖已编辑字段。
   */
  const handleAutoFillFromFace = async () => {
    if (imageUrls.length === 0) {
      setAutoFillMsg('请先加一张参考图再点自动识别');
      setTimeout(() => setAutoFillMsg(''), 4000);
      return;
    }
    setAutoFilling(true);
    setAutoFillMsg('');
    try {
      const res = await fetch('/api/character-traits/from-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imageUrls[0],
          defaultName: name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAutoFillMsg(data?.error || `识别失败 (${res.status})`);
        setTimeout(() => setAutoFillMsg(''), 5000);
        return;
      }
      // 应用结果: 仅覆盖空字段, 用户已经填的不动 (避免吞掉已经手工写的内容)
      if (!name.trim() && data.name) setName(data.name);
      // description / appearance: 拼装 traits 的可读文本
      const descParts: string[] = [];
      const genderLabel = data.gender === 'male' ? '男' : data.gender === 'female' ? '女' : '';
      const ageLabel = data.ageGroup && data.ageGroup !== '未明示' ? data.ageGroup : '';
      if (genderLabel || ageLabel) descParts.push(`${ageLabel}${genderLabel}`.trim() || (genderLabel || ageLabel));
      if (data.build && data.build !== '未明示') descParts.push(data.build);
      if (data.skinTone && data.skinTone !== '未明示') descParts.push(`${data.skinTone}肤色`);
      if (data.personality && data.personality !== '未明示') descParts.push(`气质: ${data.personality}`);
      const newDescription = descParts.join(' · ');

      const appearanceParts: string[] = [];
      if (data.appearance && data.appearance !== '未明示') appearanceParts.push(data.appearance);
      if (data.costume && data.costume !== '未明示') appearanceParts.push(`着装: ${data.costume}`);
      if (data.signature && data.signature !== '未明示') appearanceParts.push(`记号: ${data.signature}`);
      const newAppearance = appearanceParts.join(' · ');

      if (!description.trim() && newDescription) setDescription(newDescription);
      if (!appearance.trim() && newAppearance) setAppearance(newAppearance);
      // 自动加 2 个性格 tag, 已有的不重复
      if (data.personality && data.personality !== '未明示') {
        const newTags = data.personality.split(/[\s,，;；]+/).filter((t: string) => t && !visualTags.includes(t)).slice(0, 2);
        if (newTags.length) setVisualTags([...visualTags, ...newTags]);
      }
      setAutoFilledFlag(true);
      setAutoFillMsg(
        data.confident
          ? `✓ 已识别 (高置信度), 已填到空字段, 已填字段不会覆盖`
          : `⚠️ 已识别 (低置信度, 多字段未明示), 建议手工补全`,
      );
      setTimeout(() => setAutoFillMsg(''), 8000);
    } catch (e: any) {
      setAutoFillMsg(e?.message || '网络异常');
      setTimeout(() => setAutoFillMsg(''), 5000);
    } finally {
      setAutoFilling(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !visualTags.includes(t)) {
      setVisualTags([...visualTags, t]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setVisualTags(visualTags.filter((t) => t !== tag));
  };

  const addImageUrl = () => {
    const url = imageUrlInput.trim();
    if (url && !imageUrls.includes(url)) {
      setImageUrls([...imageUrls, url]);
    }
    setImageUrlInput('');
  };

  const removeImageUrl = (url: string) => {
    setImageUrls(imageUrls.filter((u) => u !== url));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('请填写角色名称');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          appearance: appearance.trim(),
          styleKeywords: styleKeywords.trim(),
          visualTags,
          imageUrls,
        }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.message || '保存失败');
      }
      const character = await res.json();
      onSaved(character);
      onClose();
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-[var(--border)] overflow-hidden flex flex-col"
        style={{ background: 'rgba(18,18,20,0.98)', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-semibold text-white">保存角色</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5 font-medium">
              角色名称 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：青枫侠客"
              className="w-full bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5 font-medium">角色描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="角色背景、性格、故事等..."
              rows={3}
              className="w-full bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/50 transition-colors resize-none"
            />
          </div>

          {/* Appearance */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5 font-medium">外貌描述</label>
            <textarea
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              placeholder="头发颜色、服饰、体型、面部特征..."
              rows={3}
              className="w-full bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/50 transition-colors resize-none"
            />
          </div>

          {/* Style Keywords */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5 font-medium">风格关键词</label>
            <input
              type="text"
              value={styleKeywords}
              onChange={(e) => setStyleKeywords(e.target.value)}
              placeholder="例：古风、赛博朋克、水墨、写实"
              className="w-full bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>

          {/* Visual Tags */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5 font-medium">视觉标签</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="输入标签后按 Enter"
                className="flex-1 bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/50 transition-colors"
              />
              <button
                onClick={addTag}
                className="px-3 py-2 rounded-xl bg-white/10 text-xs text-[var(--muted)] hover:bg-white/20 hover:text-white transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {visualTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {visualTags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[11px] border border-amber-500/20"
                  >
                    {tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-white transition-colors">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Image URLs */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5 font-medium">参考图片 URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addImageUrl())}
                placeholder="粘贴图片链接后按 Enter"
                className="flex-1 bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/50 transition-colors"
              />
              <button
                onClick={addImageUrl}
                className="px-3 py-2 rounded-xl bg-white/10 text-xs text-[var(--muted)] hover:bg-white/20 hover:text-white transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {imageUrls.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {imageUrls.map((url) => (
                  <div key={url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--border)] group">
                    <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <button
                      onClick={() => removeImageUrl(url)}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Sprint A.2 · 一键 LLM Vision 反向抽取 6 维档案 */}
            {imageUrls.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleAutoFillFromFace}
                  disabled={autoFilling}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[11.5px] border transition-colors ${
                    autoFilledFlag
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                      : 'bg-violet-500/15 border-violet-500/30 text-violet-200 hover:bg-violet-500/25'
                  } ${autoFilling ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="用 GPT-4o Vision 从第一张参考图自动识别角色档案 (性别/年龄/肤色/体型/外观/服饰/气质)"
                >
                  {autoFilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : autoFilledFlag ? <Check className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {autoFilling ? '识别中...' : autoFilledFlag ? '已识别 (再点重做)' : '从图自动识别 6 维档案'}
                </button>
                <span className="text-[10.5px] text-[var(--muted)]">仅会填到空字段, 不覆盖你已经写的</span>
              </div>
            )}
            {autoFillMsg && (
              <p className="mt-2 text-[11px] text-violet-200/85 px-1 leading-relaxed">{autoFillMsg}</p>
            )}
          </div>

          {error && (
            <p className="text-xs text-rose-400 px-1">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-[var(--muted)] hover:text-white hover:bg-white/10 transition-all"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 hover:text-amber-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '保存中...' : '保存角色'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Character Detail Modal ──────────────────────────────────────────────────

function CharacterDetailModal({
  character,
  onClose,
}: {
  character: CharacterItem;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleCopy = async () => {
    const text = [
      `【角色名称】${character.name}`,
      character.description ? `【角色描述】${character.description}` : '',
      character.appearance ? `【外貌特征】${character.appearance}` : '',
      character.styleKeywords ? `【风格关键词】${character.styleKeywords}` : '',
      character.visualTags.length > 0 ? `【视觉标签】${character.visualTags.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Increment usage count in background
      fetch(`/api/characters/${character.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usageCount: character.usageCount + 1 }),
      }).catch(() => {});
    } catch {
      // fallback: select text
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] overflow-hidden flex flex-col"
        style={{ background: 'rgba(18,18,20,0.98)', maxHeight: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--border)]">
          <h3 className="text-base font-semibold text-white truncate pr-2">{character.name}</h3>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Images */}
          {character.imageUrls.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {character.imageUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={character.name}
                  className="w-20 h-20 object-cover rounded-xl border border-[var(--border)]"
                />
              ))}
            </div>
          )}

          {character.description && (
            <div>
              <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1">角色描述</p>
              <p className="text-sm text-[var(--soft)] leading-relaxed">{character.description}</p>
            </div>
          )}

          {character.appearance && (
            <div>
              <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1">外貌特征</p>
              <p className="text-sm text-[var(--soft)] leading-relaxed">{character.appearance}</p>
            </div>
          )}

          {character.styleKeywords && (
            <div>
              <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1">风格关键词</p>
              <p className="text-sm text-amber-300/80">{character.styleKeywords}</p>
            </div>
          )}

          {character.visualTags.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1.5">视觉标签</p>
              <div className="flex flex-wrap gap-1.5">
                {character.visualTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 text-[11px] border border-amber-500/20"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] pt-1">
            <span>使用 {character.usageCount} 次</span>
            <span>·</span>
            <span>{new Date(character.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-all"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                已复制到剪贴板
              </>
            ) : (
              <>
                <Clipboard className="w-4 h-4" />
                使用角色（复制提示词）
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function CharactersPage() {
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchCharacters();
  }, []);

  const fetchCharacters = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/characters');
      const data = await res.json();
      setCharacters(Array.isArray(data) ? data : []);
    } catch {
      setCharacters([]);
    }
    setLoading(false);
  };

  const handleSaved = (character: CharacterItem) => {
    setCharacters((prev) => [character, ...prev]);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定删除该角色？')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/characters/${id}`, { method: 'DELETE' });
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      if (selectedCharacter?.id === id) setSelectedCharacter(null);
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = search.trim()
    ? characters.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.description.toLowerCase().includes(search.toLowerCase()) ||
          c.visualTags.some((t) => t.toLowerCase().includes(search.toLowerCase())) ||
          c.styleKeywords.toLowerCase().includes(search.toLowerCase())
      )
    : characters;

  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-400" />
            角色库
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            跨项目角色资产 · 共 {characters.length} 个
          </p>
        </div>

        <button
          onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          保存角色
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索角色名称、标签、风格..."
          className="w-full bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-amber-500/40 transition-colors"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-20 text-gray-500">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">
            {search.trim() ? '没有匹配的角色' : '暂无角色'}
          </p>
          {!search.trim() && (
            <p className="text-xs mt-1 text-gray-600">
              点击「保存角色」添加你的第一个角色资产
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((character) => (
            <div
              key={character.id}
              className="bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-2xl overflow-hidden group hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] transition-all duration-300 cursor-pointer"
              onClick={() => setSelectedCharacter(character)}
            >
              {/* Image area */}
              <div className="h-[140px] bg-black/30 relative overflow-hidden">
                {character.imageUrls.length > 0 ? (
                  <img
                    src={character.imageUrls[0]}
                    alt={character.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Users className="w-10 h-10 text-amber-400/20" />
                  </div>
                )}

                {/* Usage badge */}
                {character.usageCount > 0 && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/60 text-[9px] text-amber-300">
                    用 {character.usageCount} 次
                  </div>
                )}

                {/* Action buttons */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedCharacter(character); }}
                    className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-all"
                    title="查看详情"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(character.id, e)}
                    disabled={deletingId === character.id}
                    className="p-2 rounded-full bg-rose-500/30 text-rose-300 hover:bg-rose-500/50 transition-all disabled:opacity-50"
                    title="删除角色"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="p-3">
                <h4 className="text-sm font-semibold text-white truncate">{character.name}</h4>

                {character.description && (
                  <p className="text-[11px] text-[var(--muted)] mt-1 line-clamp-2 leading-relaxed">
                    {character.description}
                  </p>
                )}

                {/* Visual tags */}
                {character.visualTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {character.visualTags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/70 text-[10px] border border-amber-500/15"
                      >
                        <Tag className="w-2 h-2" />
                        {tag}
                      </span>
                    ))}
                    {character.visualTags.length > 3 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-white/5 text-[var(--muted)] text-[10px]">
                        +{character.visualTags.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between mt-2.5">
                  <span className="text-[10px] text-[var(--muted)]">
                    {new Date(character.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  {character.styleKeywords && (
                    <span className="text-[10px] text-amber-400/60 truncate max-w-[100px]">
                      {character.styleKeywords}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showSaveModal && (
        <SaveCharacterModal
          onClose={() => setShowSaveModal(false)}
          onSaved={handleSaved}
        />
      )}

      {selectedCharacter && (
        <CharacterDetailModal
          character={selectedCharacter}
          onClose={() => setSelectedCharacter(null)}
        />
      )}
    </div>
  );
}
