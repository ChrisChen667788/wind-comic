/**
 * lib/template-market (v9.6.6) — 阶段十六 T2 模板市场开篇:把成功项目沉淀成可复用模板。
 *
 * 把一个出片好的项目的「画风 + 多参元素 + 节奏 + 体量」抽成 `FilmTemplate`,按源项目质量打分,
 * 供检索/排序「一键起片」。纯逻辑、零依赖、client 可直引:
 *   - `summarizeElements(byRole)` —— 复用 `reference-elements` 的 byRole(各角色元素数组)→ 角色计数概览。
 *   - `scoreTemplate(signals)` —— 由源项目质量信号(发布门禁 / 一致性 / 多参完整度 / 口型就绪)算模板质量分。
 *   - `extractTemplate(input)` —— 抽取成 FilmTemplate(含质量分 + 标签)。
 *   - `searchTemplates / rankTemplates` —— 检索(画风/类型/关键词/最低质量)+ 按相关度·质量排序。
 *
 * T2 开篇只落纯逻辑地基(抽取/评分/检索),持久化 + 市场 UI + 一键起片留后续子版本。
 * 单测 tests/v9-6-6-template-market.test.ts。
 */

export type TemplateElementRole = 'character' | 'style' | 'scene' | 'prop' | 'motion' | 'voice';

const ROLE_TAG: Record<TemplateElementRole, string> = {
  character: '角色', style: '画风', scene: '场景', prop: '道具', motion: '运镜', voice: '配音',
};
const ALL_ROLES: TemplateElementRole[] = ['character', 'style', 'scene', 'prop', 'motion', 'voice'];

export interface TemplateElementSummary { role: TemplateElementRole; count: number; }

export interface FilmTemplate {
  id: string;
  title: string;
  /** 画风(EN 名 / 预设 id) */
  style: string;
  genre?: string;
  /** 多参元素角色概览(count>0) */
  elements: TemplateElementSummary[];
  /** 节奏基调 */
  pacingTone?: string;
  shotCount: number;
  /** 模板质量分 0-100(源项目质量沉淀) */
  quality: number;
  tags: string[];
  sourceProjectId?: string;
}

/** 源项目质量信号(都可缺;缺的不参与加权)。 */
export interface TemplateQualitySignals {
  /** 发布门禁裁决 */
  publishLevel?: 'pass' | 'warn' | 'block' | null;
  /** 一致性 0-100 */
  consistency?: number | null;
  /** 多参完整度 0-100 */
  completeness?: number | null;
  /** 口型就绪度 0-100 */
  lipSyncReadiness?: number | null;
  /** 实测口型-音频对齐均分 0-100(v9.7.15) */
  lipAudioAlign?: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function num(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** 把 bindElements 的 byRole(各角色元素数组)概览成 {role,count}(count>0,固定角色序)。 */
export function summarizeElements(byRole: Partial<Record<TemplateElementRole, unknown[]>> | null | undefined): TemplateElementSummary[] {
  const src = byRole || {};
  return ALL_ROLES
    .map((role) => ({ role, count: Array.isArray(src[role]) ? src[role]!.length : 0 }))
    .filter((e) => e.count > 0);
}

const PUBLISH_BASE: Record<NonNullable<TemplateQualitySignals['publishLevel']>, number> = {
  pass: 90, warn: 70, block: 40,
};

/**
 * 模板质量分:发布门禁为主(权重 0.5),一致性 0.25 / 多参完整度 0.15 / 口型就绪 0.10 /
 * 实测口型-音频对齐 0.15;缺的信号不计、权重在场信号间归一。全缺 → 60(未知中性)。
 */
export function scoreTemplate(signals: TemplateQualitySignals = {}): number {
  const parts: Array<{ w: number; v: number }> = [];
  if (signals.publishLevel) parts.push({ w: 0.5, v: PUBLISH_BASE[signals.publishLevel] });
  if (signals.consistency != null) parts.push({ w: 0.25, v: clamp(num(signals.consistency), 0, 100) });
  if (signals.completeness != null) parts.push({ w: 0.15, v: clamp(num(signals.completeness), 0, 100) });
  if (signals.lipSyncReadiness != null) parts.push({ w: 0.10, v: clamp(num(signals.lipSyncReadiness), 0, 100) });
  if (signals.lipAudioAlign != null) parts.push({ w: 0.15, v: clamp(num(signals.lipAudioAlign), 0, 100) });
  if (!parts.length) return 60;
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  const score = parts.reduce((s, p) => s + p.w * p.v, 0) / wsum;
  return Math.round(clamp(score, 0, 100));
}

function deriveTags(t: { style: string; genre?: string; pacingTone?: string; elements: TemplateElementSummary[] }): string[] {
  const tags = new Set<string>();
  if (t.style) tags.add(t.style.trim());
  if (t.genre) tags.add(t.genre.trim());
  if (t.pacingTone) tags.add(t.pacingTone.trim());
  for (const e of t.elements) tags.add(ROLE_TAG[e.role]);
  return [...tags].filter(Boolean);
}

export interface ExtractTemplateInput {
  id: string;
  title: string;
  style: string;
  genre?: string;
  elements?: TemplateElementSummary[];
  pacingTone?: string;
  shotCount?: number;
  signals?: TemplateQualitySignals;
  sourceProjectId?: string;
}

/** 把一个项目抽成可复用模板(质量分由 signals 算,标签由画风/类型/节奏/元素派生)。 */
export function extractTemplate(input: ExtractTemplateInput): FilmTemplate {
  const elements = Array.isArray(input.elements) ? input.elements.filter((e) => e && e.count > 0) : [];
  const style = (input.style || '').trim();
  const genre = input.genre?.trim() || undefined;
  const pacingTone = input.pacingTone?.trim() || undefined;
  return {
    id: input.id,
    title: (input.title || '').trim() || '未命名模板',
    style,
    genre,
    elements,
    pacingTone,
    shotCount: Math.max(0, Math.round(num(input.shotCount))),
    quality: scoreTemplate(input.signals || {}),
    tags: deriveTags({ style, genre, pacingTone, elements }),
    sourceProjectId: input.sourceProjectId,
  };
}

/** 按质量分降序(同分按 title)。 */
export function rankTemplates(templates: FilmTemplate[]): FilmTemplate[] {
  return [...(templates || [])].sort((a, b) => b.quality - a.quality || a.title.localeCompare(b.title));
}

export interface TemplateQuery {
  /** 关键词(匹配 标题 / 画风 / 类型 / 标签,大小写不敏感) */
  query?: string;
  genre?: string;
  style?: string;
  /** 最低质量分 */
  minQuality?: number;
}

function relevance(t: FilmTemplate, terms: string[]): number {
  if (!terms.length) return 0;
  const hay = [t.title, t.style, t.genre || '', ...t.tags].join(' ').toLowerCase();
  return terms.reduce((n, term) => (term && hay.includes(term) ? n + 1 : n), 0);
}

/**
 * 检索 + 排序:先按 genre/style/minQuality/关键词过滤,再按 相关度 → 质量 降序排。
 */
export function searchTemplates(templates: FilmTemplate[], q: TemplateQuery = {}): FilmTemplate[] {
  const list = Array.isArray(templates) ? templates : [];
  const terms = (q.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const genre = (q.genre || '').toLowerCase();
  const style = (q.style || '').toLowerCase();
  const minQ = typeof q.minQuality === 'number' ? q.minQuality : null;

  const filtered = list.filter((t) => {
    if (genre && (t.genre || '').toLowerCase() !== genre) return false;
    if (style && (t.style || '').toLowerCase() !== style) return false;
    if (minQ != null && t.quality < minQ) return false;
    if (terms.length && relevance(t, terms) === 0) return false;
    return true;
  });

  return filtered.sort((a, b) => relevance(b, terms) - relevance(a, terms) || b.quality - a.quality || a.title.localeCompare(b.title));
}
