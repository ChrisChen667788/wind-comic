/**
 * v9.6.7 — 模板市场仓库 (async, 走 DbDriver · SQLite/PG 双驱动).
 *
 * 持久化 `film_templates`:把出片好的项目沉淀成可复用模板,供市场检索 + 「一键起片」。
 * 纯检索/排序逻辑复用 `lib/template-market`(`searchTemplates`),这里只做落库 + 行映射。
 *
 * 单测: tests/v9-6-7-template-repo.test.ts。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';
import { searchTemplates, type FilmTemplate, type TemplateQuery } from '../template-market';

/** 一键起片预填载荷(选模板 → 预填进 create)。 */
export interface TemplatePayload {
  style?: string;
  styleEn?: string;
  genre?: string;
  pacingTone?: string;
  /** 多参元素(ReferenceElement[],透传给货架 / create-stream) */
  references?: unknown[];
  lockedCharacters?: unknown[];
  /** v9.7.9:角色→音色覆盖(一键起片后应用到新项目) */
  voiceOverrides?: Record<string, string>;
}

export interface StoredTemplate extends FilmTemplate {
  ownerId?: string | null;
  payload?: TemplatePayload | null;
  visibility: 'public' | 'private';
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

function safeJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function mapRow(r: any): StoredTemplate {
  return {
    id: r.id,
    title: r.title,
    style: r.style || '',
    genre: r.genre ?? undefined,
    pacingTone: r.pacing_tone ?? undefined,
    shotCount: r.shot_count ?? 0,
    quality: r.quality ?? 60,
    elements: safeJson(r.elements, []),
    tags: safeJson(r.tags, []),
    sourceProjectId: r.source_project_id ?? undefined,
    ownerId: r.owner_id ?? null,
    payload: safeJson<TemplatePayload | null>(r.payload, null),
    visibility: r.visibility === 'private' ? 'private' : 'public',
    useCount: r.use_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface SaveTemplateInput {
  template: FilmTemplate;
  ownerId?: string | null;
  payload?: TemplatePayload | null;
  visibility?: 'public' | 'private';
}

/** 落库一个模板(id 自动生成,quality/tags 由调用方经 extractTemplate 算好)。 */
export async function saveTemplate(input: SaveTemplateInput): Promise<StoredTemplate> {
  const d = getDbDriver();
  const t = input.template;
  const id = 'tpl_' + nanoid(12);
  const ts = new Date().toISOString();
  await d.run(
    `INSERT INTO film_templates
       (id, owner_id, title, style, genre, pacing_tone, shot_count, quality, elements, tags, payload, source_project_id, visibility, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id, input.ownerId ?? null, (t.title || '未命名模板').slice(0, 200), t.style || '', t.genre ?? null,
      t.pacingTone ?? null, Math.max(0, Math.round(t.shotCount || 0)), Math.round(t.quality ?? 60),
      JSON.stringify(t.elements || []), JSON.stringify(t.tags || []),
      input.payload ? JSON.stringify(input.payload) : null, t.sourceProjectId ?? null,
      input.visibility === 'private' ? 'private' : 'public', ts, ts,
    ],
  );
  return (await getTemplate(id))!;
}

export async function getTemplate(id: string): Promise<StoredTemplate | null> {
  const r = await getDbDriver().get<any>(`SELECT * FROM film_templates WHERE id = ?`, [id]);
  return r ? mapRow(r) : null;
}

/** 市场:取公开模板(质量降序)→ 经 lib/template-market 过滤 + 排序。 */
export async function listMarketTemplates(query: TemplateQuery = {}, opts: { limit?: number } = {}): Promise<StoredTemplate[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 60));
  const rows = await getDbDriver().query<any>(
    `SELECT * FROM film_templates WHERE visibility = 'public' ORDER BY quality DESC, use_count DESC LIMIT ?`, [limit],
  );
  const stored = rows.map(mapRow);
  // searchTemplates 只筛选/排序、不重建对象 → 返回的仍是 StoredTemplate 实例。
  return searchTemplates(stored, query) as StoredTemplate[];
}

export async function listOwnerTemplates(ownerId: string): Promise<StoredTemplate[]> {
  const rows = await getDbDriver().query<any>(
    `SELECT * FROM film_templates WHERE owner_id = ? ORDER BY updated_at DESC`, [ownerId],
  );
  return rows.map(mapRow);
}

/** 记一次「用此模板起片」(use_count++)。 */
export async function recordTemplateUse(id: string): Promise<boolean> {
  const t = await getTemplate(id);
  if (!t) return false;
  await getDbDriver().run(`UPDATE film_templates SET use_count = use_count + 1 WHERE id = ?`, [id]);
  return true;
}
