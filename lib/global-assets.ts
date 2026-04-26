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

// 便于测试：把行映射函数和常量导出
export const __test__ = { rowToAsset };
