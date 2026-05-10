/**
 * lib/template-share (v2.18 P2.3)
 *
 * 模板分享链接的 CRUD + 公开读取.
 *
 * 数据结构 (template_share_tokens 表):
 *   - token (PK): nanoid URL-safe
 *   - asset_id: → global_assets.id, type 必须 = 'template'
 *   - owner_user_id: 创建者, 用来鉴权 / 列出 / 删除
 *   - view_count / clone_count: 统计
 *
 * 一个 asset 可重复 createShareToken (产生新 token); 想吊销旧 token 直接 deleteToken.
 */

import { db, now } from './db';
import { nanoid } from 'nanoid';
import { getGlobalAssetById } from './global-assets';
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
    token: row.token,
    assetId: row.asset_id,
    ownerUserId: row.owner_user_id,
    viewCount: row.view_count,
    cloneCount: row.clone_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * 给一个 template 类型的 asset 创建分享 token. 调用者须先验证 asset 属于该用户。
 */
export function createShareToken(opts: {
  assetId: string;
  ownerUserId: string;
  expiresAt?: string | null;
}): TemplateShareToken {
  const token = nanoid(16); // 16 位 URL-safe, 大约 1e28 个空间
  const createdAt = now();
  db.prepare(
    `INSERT INTO template_share_tokens
       (token, asset_id, owner_user_id, view_count, clone_count, created_at, expires_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
  ).run(token, opts.assetId, opts.ownerUserId, createdAt, opts.expiresAt || null);
  return {
    token,
    assetId: opts.assetId,
    ownerUserId: opts.ownerUserId,
    viewCount: 0,
    cloneCount: 0,
    createdAt,
    expiresAt: opts.expiresAt || null,
  };
}

/** 公开读取 — 不要求 user, 但应当 +1 view_count (失败容忍). */
export function getByToken(token: string): TemplateShareToken | null {
  const row = db
    .prepare(`SELECT * FROM template_share_tokens WHERE token = ?`)
    .get(token) as TokenRow | undefined;
  if (!row) return null;
  // 过期判断
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  return rowToToken(row);
}

export function incrementViewCount(token: string): void {
  try {
    db.prepare(`UPDATE template_share_tokens SET view_count = view_count + 1 WHERE token = ?`).run(token);
  } catch (e) {
    console.warn('[template-share] view count increment failed:', e);
  }
}

export function incrementCloneCount(token: string): void {
  try {
    db.prepare(`UPDATE template_share_tokens SET clone_count = clone_count + 1 WHERE token = ?`).run(token);
  } catch (e) {
    console.warn('[template-share] clone count increment failed:', e);
  }
}

export function listTokensForOwner(ownerUserId: string): TemplateShareToken[] {
  const rows = db
    .prepare(`SELECT * FROM template_share_tokens WHERE owner_user_id = ? ORDER BY created_at DESC`)
    .all(ownerUserId) as TokenRow[];
  return rows.map(rowToToken);
}

/** 列出某 asset 现有的所有 token (一般 1 个就够). */
export function listTokensForAsset(assetId: string): TemplateShareToken[] {
  const rows = db
    .prepare(`SELECT * FROM template_share_tokens WHERE asset_id = ? ORDER BY created_at DESC`)
    .all(assetId) as TokenRow[];
  return rows.map(rowToToken);
}

export function deleteToken(token: string, ownerUserId: string): boolean {
  const result = db
    .prepare(`DELETE FROM template_share_tokens WHERE token = ? AND owner_user_id = ?`)
    .run(token, ownerUserId);
  return result.changes > 0;
}

/**
 * 一个工具: 给 token 找回背后的 GlobalAsset (验证 type='template', 否则不返).
 * +view_count 在调用方用 incrementViewCount 自己控.
 */
export function getTemplateAssetForToken(token: string): { token: TemplateShareToken; asset: GlobalAsset } | null {
  const t = getByToken(token);
  if (!t) return null;
  const asset = getGlobalAssetById(t.assetId);
  if (!asset || asset.type !== 'template') return null;
  return { token: t, asset };
}
