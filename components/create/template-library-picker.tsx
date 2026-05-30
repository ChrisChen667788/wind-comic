'use client';

/**
 * components/create/template-library-picker (v2.18 P1.1 + P1.2)
 *
 * 替代 create 页原本的水平滚动模板架, 加:
 *   - 顶部 tag chip 筛选 (基于所有 templates 的 category + tags 自动收集)
 *   - 搜索框 (按名/类别/tag 全文匹配)
 *   - 排序选项 (默认序 / 内置优先 / 个人优先)
 *   - 个人模板与内置模板统一展示, 个人有 "PERSONAL" 标 + 删除按钮
 *   - "克隆" 按钮: 把选中模板复制 + 加自定义后缀, 存入个人库 (/api/global-assets type='template')
 *   - "保存当前为模板" 由父组件 (create page) 提供 (因为依赖当前 form 状态)
 *
 * 数据形态 (个人模板存进 global_assets.metadata):
 *   {
 *     baseTemplateId?: string,   // 克隆来源 (未来可显示来源链)
 *     exampleIdea: string,
 *     structureHint: string,
 *     keyElements: string[],
 *     styleRecommendation: string,
 *     shotCount: { min, max },
 *     colorPalette: string,
 *     tags?: string[],
 *     recommendedDuration?: 5|6|10|15,
 *     recommendedAspect?: '16:9'|'9:16'|'1:1'|'2.35:1',
 *     recommendedCamera?: string,
 *   }
 */

import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass as Search, X, Trash as Trash2, Copy, User, Sparkle as Sparkles, Funnel as Filter, CaretDown as ChevronDown, CaretUp as ChevronUp, ShareNetwork as Share2, Check, Download, Upload } from '@phosphor-icons/react';
import { storyTemplates, type StoryTemplate } from '@/lib/story-templates';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface PersonalTemplate extends StoryTemplate {
  /** 由 global_assets.id 透出 — 用来 DELETE */
  personalAssetId: string;
  /** 标记 — UI 渲染 PERSONAL badge 用 */
  isPersonal: true;
}

type AnyTemplate = StoryTemplate | PersonalTemplate;

function isPersonal(t: AnyTemplate): t is PersonalTemplate {
  return (t as any).isPersonal === true;
}

export interface TemplateLibraryPickerProps {
  /** 当前选中的模板 id (null = 不选) */
  selectedId: string | null;
  /** 选模板/取消选 (传 null) — 父组件应该跑 handleSelectTemplate 自动填表单 */
  onSelect: (template: StoryTemplate | null) => void;
  /** 顶部右侧的 "保存当前为模板" 按钮渲染 — 由父组件用当前 form state 实现 */
  onSaveCurrentAsTemplate?: () => Promise<void>;
}

export function TemplateLibraryPicker({
  selectedId, onSelect, onSaveCurrentAsTemplate,
}: TemplateLibraryPickerProps) {
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<'default' | 'personal-first' | 'builtin-first'>('default');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [personalList, setPersonalList] = useState<PersonalTemplate[]>([]);
  const [loadingPersonal, setLoadingPersonal] = useState(false);
  const [cloneOpenForId, setCloneOpenForId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [savingClone, setSavingClone] = useState(false);
  // v2.18 P2.3: 已复制的分享链接 token (用来显示 "✓ 已复制" 状态)
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  // 拉个人模板
  const refreshPersonal = async () => {
    setLoadingPersonal(true);
    try {
      const res = await fetch('/api/global-assets?type=template&limit=100');
      const body = await res.json();
      const assets = Array.isArray(body?.assets) ? body.assets : [];
      setPersonalList(assets.map((a: any): PersonalTemplate => {
        const m = a.metadata || {};
        return {
          id: `personal-${a.id}`,
          personalAssetId: a.id,
          isPersonal: true,
          name: a.name,
          nameEn: m.nameEn || a.name,
          icon: m.icon || '⭐',
          category: '个人模板',
          description: a.description || '',
          exampleIdea: m.exampleIdea || '',
          structureHint: m.structureHint || '',
          emotionCurve: m.emotionCurve || '',
          keyElements: m.keyElements || [],
          styleRecommendation: m.styleRecommendation || '',
          shotCount: m.shotCount || { min: 4, max: 8 },
          colorPalette: m.colorPalette || '',
          tags: m.tags || [],
          recommendedDuration: m.recommendedDuration,
          recommendedAspect: m.recommendedAspect,
          recommendedCamera: m.recommendedCamera,
        };
      }));
    } catch (e) {
      console.warn('[TemplateLibrary] list personal failed:', e);
      setPersonalList([]);
    } finally {
      setLoadingPersonal(false);
    }
  };
  useEffect(() => { refreshPersonal(); }, []);

  // 把所有模板的 tags + categories 聚合成可筛选 chip
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of storyTemplates) {
      if (t.category) set.add(t.category);
      if (t.tags) t.tags.forEach((tag) => set.add(tag));
    }
    for (const t of personalList) {
      if (t.tags) t.tags.forEach((tag) => set.add(tag));
    }
    return Array.from(set).sort();
  }, [personalList]);

  // 全部模板合并 + 筛选
  const visibleTemplates = useMemo<AnyTemplate[]>(() => {
    const merged: AnyTemplate[] = [...storyTemplates, ...personalList];
    const q = search.trim().toLowerCase();
    return merged
      .filter((t) => {
        if (q) {
          const hay = (
            t.name + ' ' + t.nameEn + ' ' + t.category + ' ' + (t.tags || []).join(' ') + ' ' + t.description
          ).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (activeTags.size > 0) {
          const tHaystack = new Set([t.category, ...(t.tags || [])]);
          for (const need of activeTags) {
            if (!tHaystack.has(need)) return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === 'personal-first') {
          return Number(isPersonal(b)) - Number(isPersonal(a));
        }
        if (sortMode === 'builtin-first') {
          return Number(isPersonal(a)) - Number(isPersonal(b));
        }
        return 0;
      });
  }, [personalList, search, activeTags, sortMode]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleClone = async (source: AnyTemplate) => {
    const name = cloneName.trim() || `${source.name} (副本)`;
    setSavingClone(true);
    try {
      const res = await fetch('/api/global-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'template',
          name,
          description: source.description,
          metadata: {
            baseTemplateId: source.id,
            nameEn: source.nameEn,
            icon: source.icon,
            exampleIdea: source.exampleIdea,
            structureHint: source.structureHint,
            emotionCurve: source.emotionCurve,
            keyElements: source.keyElements,
            styleRecommendation: source.styleRecommendation,
            shotCount: source.shotCount,
            colorPalette: source.colorPalette,
            tags: source.tags,
            recommendedDuration: source.recommendedDuration,
            recommendedAspect: source.recommendedAspect,
            recommendedCamera: source.recommendedCamera,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn('[TemplateLibrary] clone failed:', body.error);
        return;
      }
      setCloneOpenForId(null);
      setCloneName('');
      await refreshPersonal();
    } finally {
      setSavingClone(false);
    }
  };

  const handleDeletePersonal = async (t: PersonalTemplate) => {
    if (!confirm(`删除个人模板 "${t.name}" ?`)) return;
    try {
      await fetch(`/api/global-assets/${encodeURIComponent(t.personalAssetId)}`, { method: 'DELETE' });
      if (selectedId === t.id) onSelect(null);
      await refreshPersonal();
    } catch (e) {
      console.warn('[TemplateLibrary] delete failed:', e);
    }
  };

  /**
   * v2.19 P0.4: 导出单个个人模板为 JSON 文件 — 离线团队协作场景 (绕开分享链接).
   * 文件 schema 与 storyTemplates entry 一致, 加 `__windComicTemplate: 'v1'` 标记
   * 供 import 校验. 不包含 token / userId / id 等 server-side 字段.
   */
  const handleExportTemplate = (t: AnyTemplate) => {
    const exportData = {
      __windComicTemplate: 'v1',
      __exportedAt: new Date().toISOString(),
      name: t.name,
      nameEn: t.nameEn,
      icon: t.icon,
      description: t.description,
      exampleIdea: t.exampleIdea,
      structureHint: t.structureHint,
      emotionCurve: t.emotionCurve,
      keyElements: t.keyElements,
      styleRecommendation: t.styleRecommendation,
      shotCount: t.shotCount,
      colorPalette: t.colorPalette,
      tags: t.tags,
      recommendedDuration: t.recommendedDuration,
      recommendedAspect: t.recommendedAspect,
      recommendedCamera: t.recommendedCamera,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 文件名: 模板名 (中文 OK) + 时间戳前缀, 浏览器自己 sanitize 非法字符
    a.download = `windcomic-template-${t.name.slice(0, 20)}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /**
   * v2.19 P0.4: 从 JSON 文件导入到个人库. 强校验:
   *   - 必须是 v1 schema 标记 (拒绝随便扔个 JSON 进来)
   *   - 必须有 name (其他字段全 optional)
   *   - 字段长度上限, 防 DOS
   */
  const handleImportTemplate = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed?.__windComicTemplate !== 'v1') {
        alert('不是 Wind Comic 模板 JSON. 请用 "导出" 按钮生成的文件.');
        return;
      }
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
        alert('JSON 里缺 name 字段, 无法导入');
        return;
      }
      const safeName = String(parsed.name).slice(0, 60);
      // 复用 createGlobalAsset 同款路径, 不绕 server-side 校验
      const res = await fetch('/api/global-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'template',
          name: `${safeName} (导入)`,
          description: typeof parsed.description === 'string' ? parsed.description.slice(0, 300) : undefined,
          metadata: {
            __importedAt: new Date().toISOString(),
            nameEn: typeof parsed.nameEn === 'string' ? parsed.nameEn.slice(0, 60) : undefined,
            icon: typeof parsed.icon === 'string' ? parsed.icon.slice(0, 10) : undefined,
            exampleIdea: typeof parsed.exampleIdea === 'string' ? parsed.exampleIdea.slice(0, 500) : undefined,
            structureHint: typeof parsed.structureHint === 'string' ? parsed.structureHint.slice(0, 500) : undefined,
            emotionCurve: typeof parsed.emotionCurve === 'string' ? parsed.emotionCurve.slice(0, 200) : undefined,
            keyElements: Array.isArray(parsed.keyElements) ? parsed.keyElements.slice(0, 10).map((x: unknown) => String(x).slice(0, 50)) : undefined,
            styleRecommendation: typeof parsed.styleRecommendation === 'string' ? parsed.styleRecommendation.slice(0, 200) : undefined,
            shotCount: parsed.shotCount && typeof parsed.shotCount === 'object' ? parsed.shotCount : undefined,
            colorPalette: typeof parsed.colorPalette === 'string' ? parsed.colorPalette.slice(0, 200) : undefined,
            tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10).map((x: unknown) => String(x).slice(0, 30)) : undefined,
            recommendedDuration: [5, 6, 10, 15].includes(parsed.recommendedDuration) ? parsed.recommendedDuration : undefined,
            recommendedAspect: typeof parsed.recommendedAspect === 'string' ? parsed.recommendedAspect.slice(0, 10) : undefined,
            recommendedCamera: typeof parsed.recommendedCamera === 'string' ? parsed.recommendedCamera.slice(0, 60) : undefined,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `导入失败 (${res.status})`);
        return;
      }
      await refreshPersonal();
      alert(`已导入: ${safeName} (导入)`);
    } catch (e) {
      alert(e instanceof Error ? `JSON 解析失败: ${e.message}` : 'JSON 解析失败');
    }
  };

  /**
   * v2.18 P2.3 + v2.19 P0.3: 给个人模板创建分享 token + 复制 URL 到剪贴板。
   * v2.19 加 expiresInDays 参数 — null 表示 "永久", 否则按天数生成 expires_at。
   */
  const handleSharePersonal = async (t: PersonalTemplate, expiresInDays: number | null) => {
    setSharingId(t.id);
    try {
      const res = await fetch('/api/templates/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: t.personalAssetId,
          // 传 number 表示 N 天过期; 不传表示永久 (server 端的 default)
          ...(expiresInDays != null ? { expiresInDays } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || '生成分享链接失败');
        return;
      }
      const expiryNote = body.expiresAt
        ? `\n\n⏳ 此链接 ${new Date(body.expiresAt).toLocaleDateString()} 过期`
        : '\n\n♾️ 永久有效';
      // 复制到剪贴板
      try {
        await navigator.clipboard.writeText(body.url);
        setCopiedToken(body.token);
        setTimeout(() => setCopiedToken(null), 3000);
        alert(`分享链接已复制到剪贴板:\n${body.url}\n\n任何人打开都能看到这个模板, 也能克隆到自己库。${expiryNote}`);
      } catch {
        // clipboard 失败时仍弹链接让用户手动复制
        alert(`分享链接 (请手动复制):\n${body.url}${expiryNote}`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '生成分享链接失败');
    } finally {
      setSharingId(null);
    }
  };

  const expandedTemplate = visibleTemplates.find((t) => t.id === expandedId);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="cinema-eyebrow">Genre · 故事模板库</span>
        <span className="cinema-mono text-[10px] opacity-50">
          {storyTemplates.length} 内置 · {personalList.length} 个人 · 当前显示 {visibleTemplates.length}
        </span>
      </div>

      {/* 工具条: 搜索 + 标签 popover + 排序 + 保存当前 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="text"
            placeholder="搜模板名 / 标签 / 类别"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-7 py-1.5 cinema-mono text-[11px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded focus:outline-none focus:border-[var(--cinema-amber)]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`cinema-btn !px-2.5 !py-1 !text-[11px] inline-flex items-center gap-1 ${
                activeTags.size > 0 ? 'cinema-btn-primary' : ''
              }`}
              title="按标签筛选"
            >
              <Filter className="w-3 h-3" />
              筛选 {activeTags.size > 0 && `(${activeTags.size})`}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-h-80 overflow-y-auto">
            <div className="cinema-mono text-[10px] tracking-widest opacity-60 mb-2">
              FILTER · 选 1 个或多个 (AND)
            </div>
            <div className="flex flex-wrap gap-1">
              {allTags.map((tag) => {
                const active = activeTags.has(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`cinema-btn !px-2 !py-0.5 !text-[10px] ${active ? 'cinema-btn-primary' : ''}`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            {activeTags.size > 0 && (
              <button
                onClick={() => setActiveTags(new Set())}
                className="cinema-mono text-[10px] mt-2 opacity-60 hover:opacity-100"
              >
                清空筛选
              </button>
            )}
          </PopoverContent>
        </Popover>

        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as any)}
          className="cinema-mono text-[10px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded px-2 py-1 focus:outline-none focus:border-[var(--cinema-amber)]"
          title="排序"
        >
          <option value="default">默认顺序</option>
          <option value="personal-first">个人优先</option>
          <option value="builtin-first">内置优先</option>
        </select>

        {onSaveCurrentAsTemplate && (
          <button
            type="button"
            onClick={() => onSaveCurrentAsTemplate()}
            className="cinema-btn !px-2.5 !py-1 !text-[11px] inline-flex items-center gap-1"
            title="把当前选定的画风 + idea + 镜头设置存为个人模板"
          >
            <Sparkles className="w-3 h-3" />
            存为模板
          </button>
        )}

        {/* v2.19 P0.4: 从 JSON 导入模板 (离线团队协作场景) */}
        <label
          className="cinema-btn !px-2.5 !py-1 !text-[11px] inline-flex items-center gap-1 cursor-pointer"
          title="从 JSON 文件导入模板 (绕开分享链接, 适合离线协作)"
        >
          <Upload className="w-3 h-3" />
          导入 JSON
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await handleImportTemplate(f);
              e.target.value = ''; // 允许同一文件再次选择
            }}
          />
        </label>
      </div>

      {/* 模板网格 */}
      {visibleTemplates.length === 0 ? (
        <div className="cinema-mono text-[11px] opacity-50 py-4 text-center">
          没有匹配的模板。{search && '试着清空搜索'}{activeTags.size > 0 && '/筛选'}。
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 max-h-[280px] overflow-y-auto custom-scrollbar -mx-1 px-1 pb-1">
          {visibleTemplates.map((template) => {
            const isSelected = selectedId === template.id;
            const personal = isPersonal(template);
            return (
              <div key={template.id} className="flex flex-col">
                <button
                  onClick={() => onSelect(isSelected ? null : (template as StoryTemplate))}
                  className={`overflow-hidden border text-left transition-colors relative ${
                    isSelected
                      ? 'border-[var(--cinema-amber)] bg-[var(--cinema-amber-glow)]'
                      : 'border-[var(--cinema-border)] bg-[var(--cinema-surface)] hover:border-[var(--cinema-amber-deep)]'
                  }`}
                  style={{ borderRadius: 4 }}
                >
                  {personal && (
                    <span className="absolute top-1 right-1 cinema-mono text-[8px] tracking-widest bg-[var(--cinema-amber)] text-black px-1 rounded">
                      MY
                    </span>
                  )}
                  {/* v8.3 P6: AI 生成的金色霓虹母题图标盖在 emoji 之上; 自定义模板无图 → onError 露出 emoji */}
                  <div className="relative h-[60px] flex items-center justify-center text-2xl border-b border-[var(--cinema-border)] overflow-hidden bg-[#0A0A0B]">
                    <span aria-hidden>{template.icon}</span>
                    <img
                      src={`/template-icons/${template.id}.jpg`}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <div className="px-1.5 py-1 text-center">
                    <div className="cinema-headline text-[11px] truncate">{template.name}</div>
                    <div className="cinema-mono text-[8px] opacity-50 truncate mt-0.5">{template.nameEn}</div>
                  </div>
                </button>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <button
                    onClick={() => setExpandedId(expandedId === template.id ? null : template.id)}
                    className="cinema-eyebrow hover:text-[var(--cinema-amber)] transition-colors flex items-center gap-0.5"
                    title="展开详情"
                  >
                    {expandedId === template.id ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                    详情
                  </button>
                  <Popover open={cloneOpenForId === template.id} onOpenChange={(o) => {
                    setCloneOpenForId(o ? template.id : null);
                    if (o) setCloneName(`${template.name} (副本)`);
                  }}>
                    <PopoverTrigger asChild>
                      <button
                        className="cinema-eyebrow hover:text-[var(--cinema-amber)] transition-colors flex items-center gap-0.5"
                        title="克隆为我的模板"
                      >
                        <Copy className="w-2.5 h-2.5" />
                        克隆
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="center" className="w-64 space-y-2">
                      <div className="cinema-mono text-[10px] tracking-widest opacity-60">CLONE TEMPLATE</div>
                      <input
                        autoFocus
                        type="text"
                        value={cloneName}
                        onChange={(e) => setCloneName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleClone(template); }}
                        maxLength={40}
                        className="w-full px-2 py-1.5 bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded text-sm focus:outline-none focus:border-[var(--cinema-amber)]"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCloneOpenForId(null)}
                          className="cinema-btn !px-3 !py-1 !text-[11px] flex-1"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => handleClone(template)}
                          disabled={!cloneName.trim() || savingClone}
                          className="cinema-btn cinema-btn-primary !px-3 !py-1 !text-[11px] flex-1 disabled:opacity-40"
                        >
                          {savingClone ? '保存中…' : '保存到我的库'}
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {personal && (
                    <>
                      {/* v2.19 P0.3: 分享按钮 → popover 让用户选有效期 */}
                      <Popover>
                        <PopoverTrigger
                          disabled={sharingId === template.id}
                          className="cinema-eyebrow hover:text-[var(--cinema-amber)] transition-colors flex items-center gap-0.5 disabled:opacity-50"
                          title="生成公开分享链接, 让别人能看到 + 克隆这个模板"
                        >
                          {copiedToken ? (
                            <Check className="w-2.5 h-2.5 text-[var(--cinema-green)]" />
                          ) : (
                            <Share2 className="w-2.5 h-2.5" />
                          )}
                          分享
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2">
                          <div className="cinema-mono text-[10px] opacity-60 mb-2">
                            链接有效期
                          </div>
                          <div className="flex flex-col gap-1">
                            {[
                              { label: '1 天', days: 1 },
                              { label: '7 天 (推荐)', days: 7 },
                              { label: '30 天', days: 30 },
                              { label: '永久 ♾️', days: null as number | null },
                            ].map((opt) => (
                              <button
                                key={opt.label}
                                onClick={() => handleSharePersonal(template as PersonalTemplate, opt.days)}
                                disabled={sharingId === template.id}
                                className="cinema-btn !text-[11px] !py-1 hover:cinema-btn-primary text-left disabled:opacity-50"
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <p className="cinema-mono text-[9px] opacity-50 mt-2 leading-relaxed">
                            过期后链接自动失效, 已克隆的副本不受影响
                          </p>
                        </PopoverContent>
                      </Popover>
                      {/* v2.19 P0.4: 导出 JSON */}
                      <button
                        onClick={() => handleExportTemplate(template)}
                        className="cinema-eyebrow hover:text-[var(--cinema-amber)] transition-colors flex items-center gap-0.5"
                        title="导出为 JSON 文件 (可分享给团队 / 备份)"
                      >
                        <Download className="w-2.5 h-2.5" />
                      </button>
                      <button
                        onClick={() => handleDeletePersonal(template as PersonalTemplate)}
                        className="cinema-eyebrow hover:text-[var(--cinema-red)] transition-colors flex items-center gap-0.5"
                        title="删除"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 展开详情 */}
      {expandedTemplate && (
        <div className="cinema-card-hi mt-2 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{expandedTemplate.icon}</span>
            <span className="cinema-headline text-sm">{expandedTemplate.name}</span>
            <span className="cinema-mono text-[10px] opacity-60">· {expandedTemplate.nameEn}</span>
            {isPersonal(expandedTemplate) && (
              <span className="cinema-mono text-[9px] tracking-widest bg-[var(--cinema-amber)] text-black px-1 rounded">
                <User className="w-2.5 h-2.5 inline mr-0.5" />
                PERSONAL
              </span>
            )}
          </div>
          <p className="cinema-subhead text-[11px] leading-relaxed opacity-85">{expandedTemplate.structureHint}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {(expandedTemplate.keyElements || []).map((el) => (
              <span key={el} className="cinema-chip cinema-chip-amber">{el}</span>
            ))}
          </div>
          <div className="cinema-mono text-[10px] opacity-60">EMOTION CURVE · {expandedTemplate.emotionCurve}</div>
          {expandedTemplate.tags && expandedTemplate.tags.length > 0 && (
            <div className="cinema-mono text-[10px] opacity-60">
              TAGS · {expandedTemplate.tags.join(' · ')}
            </div>
          )}
        </div>
      )}

      {loadingPersonal && (
        <div className="cinema-mono text-[10px] opacity-40 mt-1">加载个人模板…</div>
      )}
    </div>
  );
}
