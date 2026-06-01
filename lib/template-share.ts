/**
 * lib/template-share (v2.18 P2.3 · v9.0.4b 全量异步化, 走 DbDriver 双驱动)
 *
 * 模板分享链接 CRUD + 公开读取 (template_share_tokens 表)。
 */

import { getDbDriver } from './db-driver';
import { nanoid } from 'nanoid';
import { getGlobalAssetById } from './repos/global-asset-repo'; // v9.0.4b: async
import type { GlobalAsset } from '@/types/agents';

export interface TemplateShareToken {
  token: string;
  assetId: string;
  ownerUserId: string;
  viewCount: number;
  cloneCount: number;
  createdAt: string;
  expiresAt: string | null;
}

interface TokenRow {
  token: string;
  asset_id: string;
  owner_user_id: string;
  view_count: number;
  clone_count: number;
  created_at: string;
  expires_at: string | null;
}

function rowToToken(row: TokenRow): TemplateShareToken {
  return {
    token: row.token, assetId: row.asset_id, ownerUserId: row.owner_user_id,
    viewCount: row.view_count, cloneCount: row.clone_count,
    createdAt: row.created_at, expiresAt: row.expires_at,
  };
}

export async function createShareToken(opts: {
  assetId: string;
  ownerUserId: string;
  expiresAt?: string | null;
}): Promise<TemplateShareToken> {
  const token = nanoid(16);
  const createdAt = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO template_share_tokens (token, asset_id, owner_user_id, view_count, clone_count, created_at, expires_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
    [token, opts.assetId, opts.ownerUserId, createdAt, opts.expiresAt || null],
  );
  return { token, assetId: opts.assetId, ownerUserId: opts.ownerUserId, viewCount: 0, cloneCount: 0, createdAt, expiresAt: opts.expiresAt || null };
}

/** 公开读取 — 过期返 null. */
export async function getByToken(token: string): Promise<TemplateShareToken | null> {
  const row = await getDbDriver().get<TokenRow>(`SELECT * FROM template_share_tokens WHERE token = ?`, [token]);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return rowToToken(row);
}

export async function incrementViewCount(token: string): Promise<void> {
  try {
    await getDbDriver().run(`UPDATE template_share_tokens SET view_count = view_count + 1 WHERE token = ?`, [token]);
  } catch (e) {
    console.warn('[template-share] view count increment failed:', e);
  }
}

export async function incrementCloneCount(token: string): Promise<void> {
  try {
    await getDbDriver().run(`UPDATE template_share_tokens SET clone_count = clone_count + 1 WHERE token = ?`, [token]);
  } catch (e) {
    console.warn('[template-share] clone count increment failed:', e);
  }
}

export async function listTokensForOwner(ownerUserId: string): Promise<TemplateShareToken[]> {
  const rows = await getDbDriver().query<TokenRow>(
    `SELECT * FROM template_share_tokens WHERE owner_user_id = ? ORDER BY created_at DESC`, [ownerUserId]);
  return rows.map(rowToToken);
}

export async function listTokensForAsset(assetId: string): Promise<TemplateShareToken[]> {
  const rows = await getDbDriver().query<TokenRow>(
    `SELECT * FROM template_share_tokens WHERE asset_id = ? ORDER BY created_at DESC`, [assetId]);
  return rows.map(rowToToken);
}

export async function deleteToken(token: string, ownerUserId: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `DELETE FROM template_share_tokens WHERE token = ? AND owner_user_id = ?`, [token, ownerUserId]);
  return r.changes > 0;
}

/** token → 背后的 template GlobalAsset (验证 type='template'). */
export async function getTemplateAssetForToken(token: string): Promise<{ token: TemplateShareToken; asset: GlobalAsset } | null> {
  const t = await getByToken(token);
  if (!t) return null;
  const asset = await getGlobalAssetById(t.assetId);
  if (!asset || asset.type !== 'template') return null;
  return { token: t, asset };
}
