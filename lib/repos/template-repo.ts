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
  /** v9.7.12:市场卡片预览 —— 首镜分镜图 */
  previewUrl?: string;
  /** v9.7.12:市场卡片预览 —— 首镜成片视频(优先于图,静音循环播) */
  previewVideoUrl?: string;
  /** v11.1.4:拉片复刻结构(逐镜镜头语言 + 时长 + 综述提示;沉淀爆款结构可复用) */
  pullSheetStructure?: {
    shotCount: number;
    totalDurationSec: number;
    synopsisHint: string;
    perShot: Array<{ shotNumber: number; shotSize: string; cameraMovement: string; durationSec: number }>;
  };
}

export interface StoredTemplate extends FilmTemplate {
  ownerId?: string | null;
  payload?: TemplatePayload | null;
  visibility: 'public' | 'private';
  useCount: number;
  /** v9.7.16 评分均分 0-5(1 位小数;无评分 → 0) */
  ratingAvg: number;
  ratingCount: number;
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
    ratingCount: r.rating_count ?? 0,
    ratingAvg: (r.rating_count ?? 0) > 0 ? Math.round(((r.rating_sum ?? 0) / r.rating_count) * 10) / 10 : 0,
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

// ─── v9.7.16 评分 / 收藏 ───────────────────────────────────────────────────

/** 用户对模板评分(1-5,去重 upsert)→ 重算聚合 → 返 {avg, count}。模板不存在 → null。 */
export async function rateTemplate(templateId: string, userId: string, rating: number): Promise<{ avg: number; count: number } | null> {
  const d = getDbDriver();
  if (!(await getTemplate(templateId))) return null;
  const r = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
  const ts = new Date().toISOString();
  await d.run(
    `INSERT INTO template_ratings (template_id, user_id, rating, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (template_id, user_id) DO UPDATE SET rating = excluded.rating, created_at = excluded.created_at`,
    [templateId, userId, r, ts],
  );
  const agg = await d.get<{ c: number; s: number }>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(rating), 0) AS s FROM template_ratings WHERE template_id = ?`, [templateId],
  );
  const count = Number(agg?.c) || 0;
  const sum = Number(agg?.s) || 0;
  await d.run(`UPDATE film_templates SET rating_sum = ?, rating_count = ? WHERE id = ?`, [sum, count, templateId]);
  return { avg: count > 0 ? Math.round((sum / count) * 10) / 10 : 0, count };
}

export async function getUserRating(templateId: string, userId: string): Promise<number | null> {
  const r = await getDbDriver().get<{ rating: number }>(`SELECT rating FROM template_ratings WHERE template_id = ? AND user_id = ?`, [templateId, userId]);
  return r ? Number(r.rating) : null;
}

/** 收藏 / 取消收藏(on=true 收藏,false 取消)。返回最终是否已收藏。 */
export async function toggleFavorite(userId: string, templateId: string, on: boolean): Promise<boolean> {
  const d = getDbDriver();
  if (on) {
    await d.run(
      `INSERT INTO template_favorites (user_id, template_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, template_id) DO NOTHING`,
      [userId, templateId, new Date().toISOString()],
    );
    return true;
  }
  await d.run(`DELETE FROM template_favorites WHERE user_id = ? AND template_id = ?`, [userId, templateId]);
  return false;
}

export async function listFavoriteIds(userId: string): Promise<string[]> {
  const rows = await getDbDriver().query<{ template_id: string }>(`SELECT template_id FROM template_favorites WHERE user_id = ?`, [userId]);
  return rows.map((r) => r.template_id);
}

/** 我收藏的模板(按收藏时间倒序),映射成完整 StoredTemplate。 */
export async function listFavoriteTemplates(userId: string): Promise<StoredTemplate[]> {
  const rows = await getDbDriver().query<any>(
    `SELECT t.* FROM film_templates t JOIN template_favorites f ON f.template_id = t.id WHERE f.user_id = ? ORDER BY f.created_at DESC`,
    [userId],
  );
  return rows.map(mapRow);
}
