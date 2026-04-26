'use client';

/**
 * AssetGrid (v2.0 Sprint 0 D6)
 *
 * 全局资产记忆库的网格浏览 / 选择组件。
 *
 * 能力：
 *  - 通过 /api/global-assets 拉取当前用户的资产
 *  - 按 type (character / scene / style / prop) 切 tab
 *  - 搜索（q 透传后端）
 *  - 多选模式（配合 Wizard "加入项目资产" 场景）
 *  - 空态引导"去创建"
 *
 * 使用：
 *   <AssetGrid
 *     selectable
 *     selected={selectedIds}
 *     onSelectionChange={setSelectedIds}
 *   />
 */

import * as React from 'react';
import type { GlobalAsset, GlobalAssetType } from '@/types/agents';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// Type tabs
// ──────────────────────────────────────────────────────────

const TYPE_TABS: Array<{ key: GlobalAssetType | 'all'; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: '📦' },
  { key: 'character', label: '角色', icon: '👤' },
  { key: 'scene', label: '场景', icon: '🏞' },
  { key: 'style', label: '风格', icon: '🎨' },
  { key: 'prop', label: '道具', icon: '🗡' },
];

// ──────────────────────────────────────────────────────────
// Fetcher —— 独立导出便于 mock / 测试
// ──────────────────────────────────────────────────────────

export async function fetchGlobalAssets(params: {
  type?: GlobalAssetType;
  q?: string;
  token?: string;
  signal?: AbortSignal;
}): Promise<GlobalAsset[]> {
  const sp = new URLSearchParams();
  if (params.type) sp.set('type', params.type);
  if (params.q) sp.set('q', params.q);

  const res = await fetch(`/api/global-assets?${sp.toString()}`, {
    headers: params.token ? { Authorization: `Bearer ${params.token}` } : undefined,
    signal: params.signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch assets: ${res.status}`);
  }
  const data = (await res.json()) as { assets?: GlobalAsset[] };
  return data.assets ?? [];
}

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────

export interface AssetGridProps {
  /** 是否允许多选 */
  selectable?: boolean;
  /** 当前选中的资产 id 列表 */
  selected?: string[];
  onSelectionChange?: (next: string[]) => void;
  /** 允许选择的最大数量（默认 20） */
  maxSelection?: number;
  /** 初始 type 过滤 */
  initialType?: GlobalAssetType | 'all';
  /** 提供自定义 fetcher（便于单测 mock） */
  fetcher?: typeof fetchGlobalAssets;
  /** JWT token（可选，从 localStorage 读） */
  token?: string;
  /** 点击创建按钮回调（用于跳到"新建资产"页面） */
  onCreateClick?: (type: GlobalAssetType | 'all') => void;
  className?: string;
}

export function AssetGrid({
  selectable = false,
  selected = [],
  onSelectionChange,
  maxSelection = 20,
  initialType = 'all',
  fetcher = fetchGlobalAssets,
  token,
  onCreateClick,
  className,
}: AssetGridProps) {
  const [type, setType] = React.useState<GlobalAssetType | 'all'>(initialType);
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [assets, setAssets] = React.useState<GlobalAsset[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // debounce search
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // fetch
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetcher({
      type: type === 'all' ? undefined : type,
      q: debouncedQuery || undefined,
      token,
      signal: controller.signal,
    })
      .then(list => setAssets(list))
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
        setAssets([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [type, debouncedQuery, token, fetcher]);

  const toggleSelect = (id: string) => {
    if (!selectable) return;
    const set = new Set(selected);
    if (set.has(id)) {
      set.delete(id);
    } else {
      if (set.size >= maxSelection) return; // 达到上限
      set.add(id);
    }
    onSelectionChange?.(Array.from(set));
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Header: tabs + search */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2" data-testid="asset-tabs">
          {TYPE_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                type === t.key
                  ? 'border-[#E8C547]/60 bg-[#E8C547]/20 text-[#E8C547]'
                  : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10',
              )}
              data-testid={`asset-tab-${t.key}`}
            >
              <span className="mr-1">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索资产..."
          className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E8C547]/60 focus:outline-none md:w-56"
          data-testid="asset-search"
        />
      </div>

      {/* Selection counter */}
      {selectable && (
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>
            已选 <span className="font-semibold text-[#E8C547]">{selected.length}</span> /{' '}
            {maxSelection}
          </span>
          {selected.length > 0 && (
            <button
              type="button"
              className="text-neutral-400 underline hover:text-white"
              onClick={() => onSelectionChange?.([])}
            >
              清空
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <AssetSkeletonGrid />
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
          <span>加载资产失败</span>
          <span className="text-xs text-red-400/80">{error}</span>
        </div>
      ) : assets.length === 0 ? (
        <EmptyState type={type} onCreate={onCreateClick} query={debouncedQuery} />
      ) : (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          data-testid="asset-grid"
        >
          {assets.map(a => (
            <AssetCard
              key={a.id}
              asset={a}
              selected={selected.includes(a.id)}
              selectable={selectable}
              onToggle={() => toggleSelect(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// AssetCard
// ──────────────────────────────────────────────────────────

interface AssetCardProps {
  asset: GlobalAsset;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}

function AssetCard({ asset, selected, selectable, onToggle }: AssetCardProps) {
  const [imgError, setImgError] = React.useState(false);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'group relative overflow-hidden rounded-lg border-2 text-left transition-all duration-200',
        'aspect-[4/5]',
        selected
          ? 'border-[#E8C547] shadow-lg shadow-[#E8C547]/20 ring-2 ring-[#E8C547]/30'
          : 'border-white/10 hover:border-white/30',
      )}
      data-testid={`asset-card-${asset.id}`}
      data-selected={selected}
      aria-pressed={selected}
    >
      {asset.thumbnail && !imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbnail}
          alt={asset.name}
          loading="lazy"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-800 via-neutral-700 to-neutral-900 text-xs text-neutral-400">
          {asset.name}
        </div>
      )}

      {/* Type badge */}
      <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
        {TYPE_TABS.find(t => t.key === asset.type)?.icon}{' '}
        {TYPE_TABS.find(t => t.key === asset.type)?.label}
      </span>

      {/* Usage count badge (被多少项目用过) */}
      {asset.referencedByProjects.length > 0 && (
        <span className="absolute right-2 top-2 rounded bg-[#E8C547]/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
          用过 {asset.referencedByProjects.length}
        </span>
      )}

      {/* Footer */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3">
        <div className="truncate text-sm font-semibold text-white">{asset.name}</div>
        {asset.description && (
          <div className="mt-0.5 line-clamp-1 text-[11px] text-neutral-300">
            {asset.description}
          </div>
        )}
      </div>

      {/* 选中勾 */}
      {selectable && selected && (
        <div className="absolute right-2 bottom-[4.5rem] flex h-6 w-6 items-center justify-center rounded-full bg-[#E8C547] text-black shadow-lg">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-8 8a1 1 0 01-1.42 0l-4-4a1 1 0 011.42-1.42L8 12.58l7.29-7.29a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Skeleton + Empty State
// ──────────────────────────────────────────────────────────

function AssetSkeletonGrid() {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      data-testid="asset-skeleton"
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[4/5] animate-pulse rounded-lg bg-white/5"
        />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  type: GlobalAssetType | 'all';
  onCreate?: (type: GlobalAssetType | 'all') => void;
  query?: string;
}

function EmptyState({ type, onCreate, query }: EmptyStateProps) {
  const typeInfo = TYPE_TABS.find(t => t.key === type);
  const hasQuery = query && query.length > 0;

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-white/10 p-12 text-center"
      data-testid="asset-empty"
    >
      <div className="text-5xl opacity-40">{typeInfo?.icon || '📦'}</div>
      <div className="text-sm font-medium text-white">
        {hasQuery
          ? `没有匹配 "${query}" 的${typeInfo?.label ?? ''}资产`
          : `还没有${type === 'all' ? '' : typeInfo?.label ?? ''}资产`}
      </div>
      <div className="text-xs text-neutral-400">
        {hasQuery ? '试试其它关键词' : '创建你的第一个全局资产，跨项目复用'}
      </div>
      {!hasQuery && onCreate && (
        <button
          type="button"
          onClick={() => onCreate(type)}
          className="mt-2 rounded-lg bg-gradient-to-r from-[#E8C547] to-[#FF6B35] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + 创建资产
        </button>
      )}
    </div>
  );
}
