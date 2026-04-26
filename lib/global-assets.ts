/**
 * 全局资产记忆库 DAO (v2.0 Sprint 0 D4)
 *
 * 对应 `global_assets` 表 —— 跨项目复用的角色 / 场景 / 风格 / 道具。
 *
 * 设计要点：
 * - 服务端唯一真源；前端不直接操作 SQL
 * - 所有 JSON 字段（tags / visual_anchors / metadata / referenced_by_projects）
 *   在 DAO 层完成序列化 / 反序列化
 * - `referencedByProjects` 用来记录哪些项目"用过"该资产，用于未来热度统计
 * - v2.1 会接入 `embedding` 字段做相似搜索，目前仅保留列
 */

import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import type { GlobalAsset, GlobalAssetType } from '@/types/agents';

// ──────────────────────────────────────────────────────────
// Row <-> Entity 映射
// ──────────────────────────────────────────────────────────

interface GlobalAssetRow {
  id: string;
  user_id: string;
  type: string;
  name: string;
  description: string;
  tags: string;
  thumbnail: string;
  visual_anchors: string;
  embedding: string | null;
  metadata: string;
  referenced_by_projects: string;
  created_at: string;
  updated_at: string;
}

function safeParseArray<T = unknown>(s: string | null | undefined, fallback: T[] = []): T[] {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function safeParseObject<T extends Record<string, unknown>>(
  s: string | null | undefined,
  fallback: T,
): T {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function rowToAsset(row: GlobalAssetRow): GlobalAsset {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as GlobalAssetType,
    name: row.name,
    description: row.description,
    tags: safeParseArray<string>(row.tags),
    thumbnail: row.thumbnail,
    visualAnchors: safeParseArray<string>(row.visual_anchors),
    embedding: row.embedding ? safeParseArray<number>(row.embedding) : undefined,
    metadata: safeParseObject<Record<string, unknown>>(row.metadata, {}),
    referencedByProjects: safeParseArray<string>(row.referenced_by_projects),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ──────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────

export interface CreateGlobalAssetInput {
  userId: string;
  type: GlobalAssetType;
  name: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  visualAnchors?: string[];
  metadata?: Record<string, unknown>;
}

export function createGlobalAsset(input: CreateGlobalAssetInput): GlobalAsset {
  const id = nanoid();
  const ts = now();
  db.prepare(
    `INSERT INTO global_assets
      (id, user_id, type, name, description, tags, thumbnail, visual_anchors, embedding, metadata, referenced_by_projects, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.type,
    input.name,
    input.description ?? '',
    JSON.stringify(input.tags ?? []),
    input.thumbnail ?? '',
    JSON.stringify(input.visualAnchors ?? []),
    null,
    JSON.stringify(input.metadata ?? {}),
    JSON.stringify([]),
    ts,
    ts,
  );
  return getGlobalAssetById(id)!;
}

export function getGlobalAssetById(id: string): GlobalAsset | null {
  const row = db.prepare('SELECT * FROM global_assets WHERE id = ?').get(id) as
    | GlobalAssetRow
    | undefined;
  return row ? rowToAsset(row) : null;
}

export interface ListGlobalAssetsOptions {
  userId: string;
  type?: GlobalAssetType;
  q?: string; // 模糊搜索 name / description
  limit?: number;
  offset?: number;
}

export function listGlobalAssets(opts: ListGlobalAssetsOptions): GlobalAsset[] {
  const conds: string[] = ['user_id = ?'];
  const params: unknown[] = [opts.userId];

  if (opts.type) {
    conds.push('type = ?');
    params.push(opts.type);
  }

  if (opts.q && opts.q.trim().length > 0) {
    conds.push('(name LIKE ? OR description LIKE ?)');
    const like = `%${opts.q.trim()}%`;
    params.push(like, like);
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const rows = db
    .prepare(
      `SELECT * FROM global_assets
        WHERE ${conds.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as GlobalAssetRow[];

  return rows.map(rowToAsset);
}

export interface UpdateGlobalAssetInput {
  name?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  visualAnchors?: string[];
  metadata?: Record<string, unknown>;
}

export function updateGlobalAsset(
  id: string,
  userId: string,
  input: UpdateGlobalAssetInput,
): GlobalAsset | null {
  const existing = getGlobalAssetById(id);
  if (!existing) return null;
  if (existing.userId !== userId) {
    throw new Error('Forbidden: asset does not belong to user');
  }

  const fields: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    fields.push('name = ?');
    params.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push('description = ?');
    params.push(input.description);
  }
  if (input.tags !== undefined) {
    fields.push('tags = ?');
    params.push(JSON.stringify(input.tags));
  }
  if (input.thumbnail !== undefined) {
    fields.push('thumbnail = ?');
    params.push(input.thumbnail);
  }
  if (input.visualAnchors !== undefined) {
    fields.push('visual_anchors = ?');
    params.push(JSON.stringify(input.visualAnchors));
  }
  if (input.metadata !== undefined) {
    fields.push('metadata = ?');
    params.push(JSON.stringify(input.metadata));
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  params.push(now());
  params.push(id);

  db.prepare(`UPDATE global_assets SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getGlobalAssetById(id);
}

export function deleteGlobalAsset(id: string, userId: string): boolean {
  const existing = getGlobalAssetById(id);
  if (!existing) return false;
  if (existing.userId !== userId) {
    throw new Error('Forbidden: asset does not belong to user');
  }
  const res = db.prepare('DELETE FROM global_assets WHERE id = ?').run(id);
  return res.changes > 0;
}

/**
 * 记录某个项目"使用了"此全局资产（去重累加）
 * 用于未来基于热度的推荐 / 显示"已被 X 个项目使用"标签
 */
export function recordAssetUsage(
  id: string,
  userId: string,
  projectId: string,
): GlobalAsset | null {
  const existing = getGlobalAssetById(id);
  if (!existing) return null;
  if (existing.userId !== userId) {
    throw new Error('Forbidden: asset does not belong to user');
  }
  const set = new Set(existing.referencedByProjects);
  if (set.has(projectId)) {
    return existing; // 已记录，幂等返回
  }
  set.add(projectId);
  const nextJson = JSON.stringify(Array.from(set));
  db.prepare(
    'UPDATE global_assets SET referenced_by_projects = ?, updated_at = ? WHERE id = ?',
  ).run(nextJson, now(), id);
  return getGlobalAssetById(id);
}

// ──────────────────────────────────────────────────────────
// v2.12 Sprint A.3 — Character Bible 跨项目持久化
// ──────────────────────────────────────────────────────────

/**
 * Character Bible 的 metadata.bible 子对象 — global_assets 表里某个 type='character'
 * 行可以可选地携带这份信息,代表该角色被用户上传过脸 + 抽过 traits。
 *
 * 字段:
 *   role      用户在创作工坊指定的定位 (lead/antagonist/supporting/cameo)
 *   cw        Midjourney --cw 推荐值 (随 role)
 *   imageUrl  最近一次锁脸时的 persistAsset URL
 *   traits    最近一次反向抽取的 6-8 维档案 (可能为 null,如果 vision 失败过)
 *   sampleFaces  历史上传过的所有锁脸 URL (新版本上传后追加,UI 可挑一张作主参考)
 */
export interface CharacterBible {
  role: 'lead' | 'antagonist' | 'supporting' | 'cameo';
  cw: number;
  imageUrl: string;
  traits?: Record<string, unknown> | null;
  sampleFaces: string[];
  lastUsedProjectId?: string;
}

/**
 * Upsert 一个 character 类型的 global_asset,把当前项目的锁脸数据合并进 bible。
 * 同名(大小写归一)且 user_id 相同的现有 character row 会被合并;
 * 不存在则新建。返回最终的 bible 对象。
 *
 * 调用方:create-stream 在创建项目时,把每个 lockedCharacter 喂给本函数。
 */
export function upsertCharacterBible(input: {
  userId: string;
  projectId: string;
  name: string;
  bible: CharacterBible;
}): GlobalAsset {
  const ts = now();
  const normalizedName = input.name.trim();
  // 找现有同名 character (case-sensitive 完全匹配 — 跨项目复用要求精确名字)
  const existing = db
    .prepare(
      "SELECT * FROM global_assets WHERE user_id = ? AND type = 'character' AND name = ? LIMIT 1",
    )
    .get(input.userId, normalizedName) as GlobalAssetRow | undefined;

  if (existing) {
    const prevAsset = rowToAsset(existing);
    const prevBible = (prevAsset.metadata.bible as Partial<CharacterBible> | undefined) || {};
    const prevSamples = Array.isArray(prevBible.sampleFaces) ? (prevBible.sampleFaces as string[]) : [];
    const mergedSamples = Array.from(new Set([
      input.bible.imageUrl,
      ...input.bible.sampleFaces,
      ...prevSamples,
    ].filter(Boolean))).slice(0, 10); // 最多保留最近 10 张
    const mergedBible: CharacterBible = {
      ...prevBible,
      ...input.bible,
      sampleFaces: mergedSamples,
      lastUsedProjectId: input.projectId,
    };
    const refSet = new Set(prevAsset.referencedByProjects);
    refSet.add(input.projectId);
    const refJson = JSON.stringify(Array.from(refSet));
    const metadataJson = JSON.stringify({
      ...prevAsset.metadata,
      bible: mergedBible,
    });
    db.prepare(
      `UPDATE global_assets SET metadata = ?, thumbnail = ?, referenced_by_projects = ?, updated_at = ? WHERE id = ?`,
    ).run(metadataJson, input.bible.imageUrl, refJson, ts, existing.id);
    return getGlobalAssetById(existing.id)!;
  }

  // 新建 character row — 也对 sampleFaces 应用 10 张上限
  const initialSamples = Array.from(new Set(
    [input.bible.imageUrl, ...input.bible.sampleFaces].filter(Boolean),
  )).slice(0, 10);
  return createGlobalAsset({
    userId: input.userId,
    type: 'character',
    name: normalizedName,
    description: '',
    thumbnail: input.bible.imageUrl,
    metadata: {
      bible: {
        ...input.bible,
        sampleFaces: initialSamples,
        lastUsedProjectId: input.projectId,
      },
    },
  });
}

/**
 * 按 (user_id, name) 精确查找一个已存在的 Character Bible。
 * 找到 → 返回 bible + 历史项目数;找不到 → null。
 *
 * 给前端 CharacterLockSection 在用户输入角色名时实时检测复用机会用。
 */
export function findCharacterBibleByName(
  userId: string,
  name: string,
): { bible: CharacterBible; usedInProjectsCount: number } | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const row = db
    .prepare(
      "SELECT * FROM global_assets WHERE user_id = ? AND type = 'character' AND name = ? LIMIT 1",
    )
    .get(userId, trimmed) as GlobalAssetRow | undefined;
  if (!row) return null;
  const asset = rowToAsset(row);
  const bible = asset.metadata.bible as CharacterBible | undefined;
  if (!bible || !bible.imageUrl) return null;
  return {
    bible,
    usedInProjectsCount: asset.referencedByProjects.length,
  };
}

// 便于测试：把行映射函数和常量导出
export const __test__ = { rowToAsset };
