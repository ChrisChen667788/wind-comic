/**
 * v4.2.3 — 项目资产仓库 (async, 走 DbDriver).
 *
 * PG 迁移分模块异步化第三个模块 (auth / projects 之后): project_assets 域.
 * 走异步 DbDriver, SQLite/PG 双驱动, 占位符统一 `?`.
 *
 * 单测: tests/v4-2-3-asset-repo.test.ts.
 */

import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface AssetRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  data: string;
  media_urls: string | null;
  /**
   * v2.9 资产持久化副本 URL (/api/serve-file?key=...). 外链/tmp 会过期,
   * 这一列指向本地落盘的稳定副本; normalizeAssetRow 会优先用它。
   * ⚠️ 必须 SELECT 出来 —— v4.2.3 异步化时漏选此列, 导致历史项目图片/视频
   * 回退到已过期的 media_urls → 404 无法查看 (regression, 见 tests/v6-0-1).
   */
  persistent_url: string | null;
  shot_number: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at';

export async function listProjectAssets(projectId: string): Promise<AssetRow[]> {
  return getDbDriver().query<AssetRow>(
    `SELECT ${COLS} FROM project_assets WHERE project_id = ? ORDER BY type, shot_number`,
    [projectId],
  );
}

export async function listAssetsByType(projectId: string, type: string): Promise<AssetRow[]> {
  return getDbDriver().query<AssetRow>(
    `SELECT ${COLS} FROM project_assets WHERE project_id = ? AND type = ? ORDER BY shot_number`,
    [projectId, type],
  );
}

export async function getAsset(id: string): Promise<AssetRow | null> {
  return getDbDriver().get<AssetRow>(`SELECT ${COLS} FROM project_assets WHERE id = ?`, [id]);
}

export interface CreateAssetInput {
  projectId: string;
  type: string;
  name: string;
  data?: unknown;
  mediaUrls?: string[];
  shotNumber?: number | null;
  version?: number;
  /** v9.0.1: 自定义 id (默认 nanoid; 如 storyboard 重生用 `sb-...`) */
  id?: string;
  /** v9.0.1: 落库持久化副本 URL */
  persistentUrl?: string | null;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetRow> {
  const driver = getDbDriver();
  const id = input.id || nanoid();
  const ts = new Date().toISOString();
  await driver.run(
    `INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.projectId, input.type, input.name,
      JSON.stringify(input.data ?? {}), JSON.stringify(input.mediaUrls ?? []),
      input.persistentUrl ?? null, input.shotNumber ?? null, input.version ?? 1, ts, ts,
    ],
  );
  const row = await getAsset(id);
  if (!row) throw new Error('createAsset: 插入后读取失败');
  return row;
}

/** 更新资产 data / media_urls / persistent_url; bumpVersion 时 version+1. */
export async function updateAsset(
  id: string,
  patch: { data?: unknown; mediaUrls?: string[]; persistentUrl?: string | null; bumpVersion?: boolean },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.data !== undefined) { sets.push('data = ?'); params.push(JSON.stringify(patch.data)); }
  if (patch.mediaUrls !== undefined) { sets.push('media_urls = ?'); params.push(JSON.stringify(patch.mediaUrls)); }
  if (patch.persistentUrl !== undefined) { sets.push('persistent_url = ?'); params.push(patch.persistentUrl); }
  if (patch.bumpVersion) sets.push('version = version + 1');
  if (sets.length === 0) return false;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);
  const r = await getDbDriver().run(`UPDATE project_assets SET ${sets.join(', ')} WHERE id = ?`, params);
  return r.changes > 0;
}

/** v9.0.1: 带 project 守卫的 data 更新 (WHERE id AND project_id). */
export async function updateAssetDataInProject(id: string, projectId: string, data: unknown): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE project_assets SET data = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
    [JSON.stringify(data), new Date().toISOString(), id, projectId],
  );
  return r.changes > 0;
}

/** v9.0.1: 按 (project, type, shot|name) 选中更新 media/persistent/data. 返回受影响行数. */
export async function updateAssetBySelector(
  projectId: string,
  sel: { type: string; shotNumber?: number | null; name?: string },
  patch: { mediaUrls?: string[]; persistentUrl?: string | null; data?: unknown; bumpVersion?: boolean },
): Promise<number> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.mediaUrls !== undefined) { sets.push('media_urls = ?'); params.push(JSON.stringify(patch.mediaUrls)); }
  if (patch.persistentUrl !== undefined) { sets.push('persistent_url = ?'); params.push(patch.persistentUrl); }
  if (patch.data !== undefined) { sets.push('data = ?'); params.push(JSON.stringify(patch.data)); }
  if (patch.bumpVersion) sets.push('version = version + 1');
  if (sets.length === 0) return 0;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  let where = 'project_id = ? AND type = ?';
  params.push(projectId, sel.type);
  if (sel.shotNumber != null) { where += ' AND shot_number = ?'; params.push(sel.shotNumber); }
  else { where += ' AND name = ?'; params.push(sel.name); }
  const r = await getDbDriver().run(`UPDATE project_assets SET ${sets.join(', ')} WHERE ${where}`, params);
  return r.changes;
}

/**
 * v10.4.2: 幂等写 —— 按 (project, type, shot|name) 先更新,没命中再插入。
 * 流水线续跑/重跑时同一产物不再重复 INSERT(v10.4.1 已知限位:重跑资产 ×2)。
 * mediaUrls 仅在非空时参与更新 —— 渲染失败传 [] 不应抹掉已有的好 URL。
 * 命中多行(历史重复行)会被一并刷成同值,属自愈。返回 'created' | 'updated'。
 */
export async function upsertAsset(input: CreateAssetInput): Promise<'created' | 'updated'> {
  const sel = input.shotNumber != null
    ? { type: input.type, shotNumber: input.shotNumber }
    : { type: input.type, name: input.name };
  const patch: { data?: unknown; mediaUrls?: string[]; persistentUrl?: string | null; bumpVersion?: boolean } = {
    data: input.data ?? {},
    bumpVersion: true,
  };
  if (input.mediaUrls && input.mediaUrls.length > 0) patch.mediaUrls = input.mediaUrls;
  // v12.26.0(评审):透传 persistentUrl(原 upsert 更新路径漏传 → 重导/重生不更新持久 URL)
  if (input.persistentUrl !== undefined) patch.persistentUrl = input.persistentUrl;
  const changes = await updateAssetBySelector(input.projectId, sel, patch);
  if (changes > 0) return 'updated';
  await createAsset(input);
  return 'created';
}

export async function deleteAsset(id: string): Promise<boolean> {
  const r = await getDbDriver().run(`DELETE FROM project_assets WHERE id = ?`, [id]);
  return r.changes > 0;
}

/** v9.0.1: 删除某 project 下某 type 的全部资产 (如 narration 重生前清空). 返回行数. */
export async function deleteAssetsByType(projectId: string, type: string): Promise<number> {
  const r = await getDbDriver().run(`DELETE FROM project_assets WHERE project_id = ? AND type = ?`, [projectId, type]);
  return r.changes;
}

/** v10.6.1: 按镜号置 stale —— 台账条目(服装/场景/道具)描述变更后,只失效受影响镜头. */
export async function setAssetsStaleByShots(
  projectId: string,
  types: string[],
  shotNumbers: number[],
  stale: boolean,
): Promise<number> {
  if (types.length === 0 || shotNumbers.length === 0) return 0;
  const tph = types.map(() => '?').join(', ');
  const sph = shotNumbers.map(() => '?').join(', ');
  const r = await getDbDriver().run(
    `UPDATE project_assets SET stale = ? WHERE project_id = ? AND type IN (${tph}) AND shot_number IN (${sph})`,
    [stale ? 1 : 0, projectId, ...types, ...shotNumbers],
  );
  return r.changes;
}

/** v9.0.1: 批量置 stale (rerun: 选中重跑环节的下游失效). */
export async function setAssetsStaleByTypes(projectId: string, types: string[], stale: boolean): Promise<number> {
  if (types.length === 0) return 0;
  const ph = types.map(() => '?').join(', ');
  const r = await getDbDriver().run(
    `UPDATE project_assets SET stale = ? WHERE project_id = ? AND type IN (${ph})`,
    [stale ? 1 : 0, projectId, ...types],
  );
  return r.changes;
}

export async function setAssetStale(id: string, projectId: string, stale: boolean): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE project_assets SET stale = ? WHERE id = ? AND project_id = ?`,
    [stale ? 1 : 0, id, projectId],
  );
  return r.changes > 0;
}

/** v9.0.1: 批量确认 (assets/confirm). */
export async function setAssetsConfirmedByTypes(projectId: string, types: string[]): Promise<number> {
  if (types.length === 0) return 0;
  const ph = types.map(() => '?').join(', ');
  const r = await getDbDriver().run(
    `UPDATE project_assets SET confirmed = 1, updated_at = ? WHERE project_id = ? AND type IN (${ph})`,
    [new Date().toISOString(), projectId, ...types],
  );
  return r.changes;
}

export async function setAssetConfirmed(id: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE project_assets SET confirmed = 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id],
  );
  return r.changes > 0;
}

export async function countProjectAssets(projectId: string): Promise<number> {
  const r = await getDbDriver().get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM project_assets WHERE project_id = ?`, [projectId],
  );
  return r?.c ?? 0;
}
