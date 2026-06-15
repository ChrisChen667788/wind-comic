/**
 * v9.0.3b — 全局资产仓库 (async, 走 DbDriver).
 *
 * PG 迁移阶段十一新建 repo 第二个: global_assets 域 (跨项目复用的角色/场景/风格/道具
 * + Character Bible 跨项目持久化). SQLite/PG 双驱动, 占位符统一 `?`。
 * 路由 + create-stream 走这里; 旧 `lib/global-assets.ts` 同步版保留给其既有单测。
 *
 * 单测: tests/v9-0-3b-global-asset-repo.test.ts.
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';
import type { GlobalAsset, GlobalAssetType } from '@/types/agents';

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
  try { const v = JSON.parse(s); return Array.isArray(v) ? (v as T[]) : fallback; } catch { return fallback; }
}
function safeParseObject<T extends Record<string, unknown>>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback; } catch { return fallback; }
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

export async function createGlobalAsset(input: CreateGlobalAssetInput): Promise<GlobalAsset> {
  const id = nanoid();
  const ts = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO global_assets
      (id, user_id, type, name, description, tags, thumbnail, visual_anchors, embedding, metadata, referenced_by_projects, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.userId, input.type, input.name, input.description ?? '',
      JSON.stringify(input.tags ?? []), input.thumbnail ?? '',
      JSON.stringify(input.visualAnchors ?? []), null,
      JSON.stringify(input.metadata ?? {}), JSON.stringify([]), ts, ts,
    ],
  );
  const created = await getGlobalAssetById(id);
  if (!created) throw new Error('createGlobalAsset: 插入后读取失败');
  return created;
}

export async function getGlobalAssetById(id: string): Promise<GlobalAsset | null> {
  const row = await getDbDriver().get<GlobalAssetRow>('SELECT * FROM global_assets WHERE id = ?', [id]);
  return row ? rowToAsset(row) : null;
}

export interface ListGlobalAssetsOptions {
  userId: string;
  type?: GlobalAssetType;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listGlobalAssets(opts: ListGlobalAssetsOptions): Promise<GlobalAsset[]> {
  const conds: string[] = ['user_id = ?'];
  const params: unknown[] = [opts.userId];
  if (opts.type) { conds.push('type = ?'); params.push(opts.type); }
  if (opts.q && opts.q.trim().length > 0) {
    conds.push('(name LIKE ? OR description LIKE ?)');
    const like = `%${opts.q.trim()}%`;
    params.push(like, like);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await getDbDriver().query<GlobalAssetRow>(
    `SELECT * FROM global_assets WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
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

export async function updateGlobalAsset(
  id: string,
  userId: string,
  input: UpdateGlobalAssetInput,
): Promise<GlobalAsset | null> {
  const existing = await getGlobalAssetById(id);
  if (!existing) return null;
  if (existing.userId !== userId) throw new Error('Forbidden: asset does not belong to user');

  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) { fields.push('name = ?'); params.push(input.name); }
  if (input.description !== undefined) { fields.push('description = ?'); params.push(input.description); }
  if (input.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(input.tags)); }
  if (input.thumbnail !== undefined) { fields.push('thumbnail = ?'); params.push(input.thumbnail); }
  if (input.visualAnchors !== undefined) { fields.push('visual_anchors = ?'); params.push(JSON.stringify(input.visualAnchors)); }
  if (input.metadata !== undefined) { fields.push('metadata = ?'); params.push(JSON.stringify(input.metadata)); }
  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  await getDbDriver().run(`UPDATE global_assets SET ${fields.join(', ')} WHERE id = ?`, params);
  return getGlobalAssetById(id);
}

export async function deleteGlobalAsset(id: string, userId: string): Promise<boolean> {
  const existing = await getGlobalAssetById(id);
  if (!existing) return false;
  if (existing.userId !== userId) throw new Error('Forbidden: asset does not belong to user');
  const r = await getDbDriver().run('DELETE FROM global_assets WHERE id = ?', [id]);
  return r.changes > 0;
}

/** 记录某项目"使用了"此全局资产 (去重累加, 幂等). */
export async function recordAssetUsage(id: string, userId: string, projectId: string): Promise<GlobalAsset | null> {
  const existing = await getGlobalAssetById(id);
  if (!existing) return null;
  if (existing.userId !== userId) throw new Error('Forbidden: asset does not belong to user');
  const set = new Set(existing.referencedByProjects);
  if (set.has(projectId)) return existing; // 已记录, 幂等
  set.add(projectId);
  await getDbDriver().run(
    'UPDATE global_assets SET referenced_by_projects = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(Array.from(set)), new Date().toISOString(), id],
  );
  return getGlobalAssetById(id);
}

// ─── Character Bible 跨项目持久化 (存为 type='character' 的 global_asset.metadata.bible) ───

export interface CharacterBible {
  role: 'lead' | 'antagonist' | 'supporting' | 'cameo';
  cw: number;
  imageUrl: string;
  traits?: Record<string, unknown> | null;
  sampleFaces: string[];
  lastUsedProjectId?: string;
}

/** Upsert 一个 character 类型 global_asset, 合并当前项目的锁脸 bible. */
export async function upsertCharacterBible(input: {
  userId: string;
  projectId: string;
  name: string;
  bible: CharacterBible;
}): Promise<GlobalAsset> {
  const ts = new Date().toISOString();
  const normalizedName = input.name.trim();
  const existing = await getDbDriver().get<GlobalAssetRow>(
    "SELECT * FROM global_assets WHERE user_id = ? AND type = 'character' AND name = ? LIMIT 1",
    [input.userId, normalizedName],
  );

  if (existing) {
    const prevAsset = rowToAsset(existing);
    const prevBible = (prevAsset.metadata.bible as Partial<CharacterBible> | undefined) || {};
    const prevSamples = Array.isArray(prevBible.sampleFaces) ? (prevBible.sampleFaces as string[]) : [];
    const mergedSamples = Array.from(new Set(
      [input.bible.imageUrl, ...input.bible.sampleFaces, ...prevSamples].filter(Boolean),
    )).slice(0, 10);
    const mergedBible: CharacterBible = {
      ...prevBible, ...input.bible, sampleFaces: mergedSamples, lastUsedProjectId: input.projectId,
    };
    const refSet = new Set(prevAsset.referencedByProjects);
    refSet.add(input.projectId);
    const metadataJson = JSON.stringify({ ...prevAsset.metadata, bible: mergedBible });
    await getDbDriver().run(
      `UPDATE global_assets SET metadata = ?, thumbnail = ?, referenced_by_projects = ?, updated_at = ? WHERE id = ?`,
      [metadataJson, input.bible.imageUrl, JSON.stringify(Array.from(refSet)), ts, existing.id],
    );
    const updated = await getGlobalAssetById(existing.id);
    if (!updated) throw new Error('upsertCharacterBible: 更新后读取失败');
    void embedAsset(updated.id); // v12.2.2 机会主义向量化(fire-and-forget,无 key/MOCK 自降级)
    return updated;
  }

  const initialSamples = Array.from(new Set(
    [input.bible.imageUrl, ...input.bible.sampleFaces].filter(Boolean),
  )).slice(0, 10);
  const created = await createGlobalAsset({
    userId: input.userId,
    type: 'character',
    name: normalizedName,
    description: '',
    thumbnail: input.bible.imageUrl,
    metadata: { bible: { ...input.bible, sampleFaces: initialSamples, lastUsedProjectId: input.projectId } },
  });
  void embedAsset(created.id); // v12.2.2 机会主义向量化
  return created;
}

/** 按 (user_id, name) 精确查 Character Bible. 找到 → bible + 历史项目数; 否则 null. */
export async function findCharacterBibleByName(
  userId: string,
  name: string,
): Promise<{ bible: CharacterBible; usedInProjectsCount: number } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const row = await getDbDriver().get<GlobalAssetRow>(
    "SELECT * FROM global_assets WHERE user_id = ? AND type = 'character' AND name = ? LIMIT 1",
    [userId, trimmed],
  );
  if (!row) return null;
  const asset = rowToAsset(row);
  const bible = asset.metadata.bible as CharacterBible | undefined;
  if (!bible || !bible.imageUrl) return null;
  return { bible, usedInProjectsCount: asset.referencedByProjects.length };
}

// ─── v12.2.2 资产向量化(把 embedding 死列通电)──────────────────────────────

/** 写 embedding 列(bare number[] JSON,匹配既有解析)+ 把 model/dim 记进 metadata(供检索按模型过滤)。 */
export async function setGlobalAssetEmbedding(id: string, vector: number[], model: string): Promise<void> {
  const existing = await getGlobalAssetById(id);
  if (!existing) return;
  const metadata = { ...existing.metadata, embeddingModel: model, embeddingDim: vector.length };
  await getDbDriver().run(
    'UPDATE global_assets SET embedding = ?, metadata = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(vector), JSON.stringify(metadata), new Date().toISOString(), id],
  );
}

/**
 * 给单个资产嵌入并落库。无 key/MOCK/空源/失败 → 返回 false(embedding 保持空,诚实降级)。
 * 机会主义触发(fire-and-forget),失败不阻塞主流程。
 */
export async function embedAsset(id: string): Promise<boolean> {
  try {
    const asset = await getGlobalAssetById(id);
    if (!asset) return false;
    const { buildEmbedSource, embedText } = await import('../asset-embedding');
    const source = buildEmbedSource(asset);
    if (!source) return false;
    const res = await embedText(source);
    if (!res) return false;
    await setGlobalAssetEmbedding(id, res.vector, res.model);
    return true;
  } catch (e) {
    console.warn('[GlobalAsset] embedAsset failed (non-blocking):', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * v12.2.3 确定性文本兜底:无 embedding 时按名/描述/anchors 文本相似找该 user 的同类资产。
 * 永远可跑(零 BYO)。用于 /api/global-assets/similar 在向量不可用时退回。
 */
export async function findSimilarGlobalAssetsByText(
  userId: string,
  query: string,
  opts?: { type?: GlobalAssetType; k?: number; minScore?: number; excludeId?: string },
): Promise<Array<{ asset: GlobalAsset; score: number }>> {
  if (!query?.trim()) return [];
  const assets = await listGlobalAssets({ userId, type: opts?.type, limit: 200 });
  const { textMatchScore } = await import('../asset-embedding');
  const k = Math.max(1, opts?.k ?? 5);
  const min = opts?.minScore ?? 0.3;
  return assets
    .filter((a) => !opts?.excludeId || a.id !== opts.excludeId)
    .map((asset) => ({ asset, score: textMatchScore(query, asset) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * 按向量相似找该 user 的同类资产(跨集/跨项目复用核心)。
 * 只比同 model 的向量(维度/模型不一致不可比 → 跳过)。无 query → []。纯检索,不改库。
 */
export async function findSimilarGlobalAssets(
  userId: string,
  query: { vector: number[]; model: string },
  opts?: { type?: GlobalAssetType; k?: number; minScore?: number; excludeId?: string },
): Promise<Array<{ asset: GlobalAsset; score: number }>> {
  if (!query?.vector?.length) return [];
  const conds = ['user_id = ?', 'embedding IS NOT NULL'];
  const params: unknown[] = [userId];
  if (opts?.type) { conds.push('type = ?'); params.push(opts.type); }
  const rows = await getDbDriver().query<GlobalAssetRow>(
    `SELECT * FROM global_assets WHERE ${conds.join(' AND ')}`,
    params,
  );
  const { cosineSimilarity } = await import('../asset-embedding');
  const k = Math.max(1, opts?.k ?? 5);
  const min = opts?.minScore ?? 0;
  const scored: Array<{ asset: GlobalAsset; score: number }> = [];
  for (const row of rows) {
    const asset = rowToAsset(row);
    if (opts?.excludeId && asset.id === opts.excludeId) continue;
    if (!asset.embedding?.length) continue;
    if ((asset.metadata as any)?.embeddingModel && (asset.metadata as any).embeddingModel !== query.model) continue; // 异模型不可比
    if (asset.embedding.length !== query.vector.length) continue; // 异维不可比
    const score = cosineSimilarity(query.vector, asset.embedding);
    if (score > min) scored.push({ asset, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
