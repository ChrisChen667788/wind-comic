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
  shot_number: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, project_id, type, name, data, media_urls, shot_number, version, created_at, updated_at';

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
}

export async function createAsset(input: CreateAssetInput): Promise<AssetRow> {
  const driver = getDbDriver();
  const id = nanoid();
  const ts = new Date().toISOString();
  await driver.run(
    `INSERT INTO project_assets (id, project_id, type, name, data, media_urls, shot_number, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.projectId, input.type, input.name,
      JSON.stringify(input.data ?? {}), JSON.stringify(input.mediaUrls ?? []),
      input.shotNumber ?? null, input.version ?? 1, ts, ts,
    ],
  );
  const row = await getAsset(id);
  if (!row) throw new Error('createAsset: 插入后读取失败');
  return row;
}

/** 更新资产 data / media_urls. */
export async function updateAsset(
  id: string,
  patch: { data?: unknown; mediaUrls?: string[] },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.data !== undefined) { sets.push('data = ?'); params.push(JSON.stringify(patch.data)); }
  if (patch.mediaUrls !== undefined) { sets.push('media_urls = ?'); params.push(JSON.stringify(patch.mediaUrls)); }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);
  const r = await getDbDriver().run(`UPDATE project_assets SET ${sets.join(', ')} WHERE id = ?`, params);
  return r.changes > 0;
}

export async function deleteAsset(id: string): Promise<boolean> {
  const r = await getDbDriver().run(`DELETE FROM project_assets WHERE id = ?`, [id]);
  return r.changes > 0;
}

export async function countProjectAssets(projectId: string): Promise<number> {
  const r = await getDbDriver().get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM project_assets WHERE project_id = ?`, [projectId],
  );
  return r?.c ?? 0;
}
