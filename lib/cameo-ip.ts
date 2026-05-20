/**
 * v4.0 — Cameo IP 经济.
 *
 * 把 character_library 里的角色 token 化, 经授权可被其他用户复用 (Sora-style cameo).
 * 创作者经济雏形: 角色作者发 IP token + 设授权级别/版税, 他人申请复用.
 *
 * 权限模型 (resolveAccess 纯函数, 单测覆盖):
 *   owner   → 永远可用
 *   revoked → 除 owner 外都不可用
 *   public + license(remix/commercial) → 任何人直接可用 (open)
 *   其他 → 需 owner 批准的 grant (approved=granted / pending=待批 / 无=denied)
 *
 * 单测: tests/v4-0-cameo-ip.test.ts.
 */

import { nanoid } from 'nanoid';
import { db, now } from './db';

export type IpVisibility = 'public' | 'unlisted' | 'private';
export type IpLicense = 'view' | 'remix' | 'commercial';
export type IpStatus = 'active' | 'revoked';
export type GrantStatus = 'pending' | 'approved' | 'revoked';
export type AccessLevel = 'owner' | 'open' | 'granted' | 'pending' | 'denied';

export interface IpToken {
  id: string;
  characterId: string;
  ownerId: string;
  name: string;
  coverUrl: string | null;
  visibility: IpVisibility;
  license: IpLicense;
  terms: string;
  royaltyCny: number;
  status: IpStatus;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IpGrant {
  id: string;
  tokenId: string;
  granteeId: string;
  status: GrantStatus;
  useCount: number;
  message: string;
  createdAt: string;
  decidedAt: string | null;
}

// ─── 纯权限逻辑 (单测核心) ────────────────────────────────────────────────

/** license 是否允许"用在自己项目里"(非纯查看). */
export function licenseAllowsReuse(license: IpLicense): boolean {
  return license === 'remix' || license === 'commercial';
}

/**
 * 解析某用户对某 token 的访问级别. 纯函数.
 * grant 传 null 表示该用户对该 token 没有任何 grant 记录.
 */
export function resolveAccess(
  token: Pick<IpToken, 'ownerId' | 'visibility' | 'license' | 'status'>,
  grant: Pick<IpGrant, 'status'> | null,
  userId: string,
): AccessLevel {
  if (token.ownerId === userId) return 'owner';
  if (token.status === 'revoked') return 'denied';
  if (token.visibility === 'public' && licenseAllowsReuse(token.license)) return 'open';
  if (grant) {
    if (grant.status === 'approved') return 'granted';
    if (grant.status === 'pending') return 'pending';
  }
  return 'denied';
}

/** 访问级别是否真的允许复用 (owner/open/granted 可, pending/denied 不可). */
export function accessCanReuse(level: AccessLevel): boolean {
  return level === 'owner' || level === 'open' || level === 'granted';
}

function clampRoyalty(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100000, Math.round(n * 100) / 100);
}

function normVisibility(v: unknown): IpVisibility {
  return v === 'public' || v === 'unlisted' ? v : 'private';
}
function normLicense(v: unknown): IpLicense {
  return v === 'remix' || v === 'commercial' ? v : 'view';
}

// ─── 行映射 ───────────────────────────────────────────────────────────────

function mapTokenRow(r: any): IpToken {
  return {
    id: r.id, characterId: r.character_id, ownerId: r.owner_id, name: r.name,
    coverUrl: r.cover_url ?? null, visibility: r.visibility, license: r.license,
    terms: r.terms || '', royaltyCny: r.royalty_cny ?? 0, status: r.status,
    useCount: r.use_count ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapGrantRow(r: any): IpGrant {
  return {
    id: r.id, tokenId: r.token_id, granteeId: r.grantee_id, status: r.status,
    useCount: r.use_count ?? 0, message: r.message || '',
    createdAt: r.created_at, decidedAt: r.decided_at ?? null,
  };
}

// ─── Token 发行 / 撤销 / 读取 ──────────────────────────────────────────────

export interface IssueTokenInput {
  characterId: string;
  ownerId: string;
  name: string;
  coverUrl?: string | null;
  visibility?: IpVisibility;
  license?: IpLicense;
  terms?: string;
  royaltyCny?: number;
}

/** 发行 / 更新一个角色的 IP token (一个角色一个 token, UPSERT). */
export function issueIpToken(input: IssueTokenInput): IpToken {
  const existing = db
    .prepare(`SELECT * FROM character_ip_tokens WHERE character_id = ?`)
    .get(input.characterId) as any;
  const ts = now();
  if (existing) {
    if (existing.owner_id !== input.ownerId) {
      throw new Error('issueIpToken: 只有角色所有者能发/改 IP token');
    }
    db.prepare(
      `UPDATE character_ip_tokens
       SET name=?, cover_url=?, visibility=?, license=?, terms=?, royalty_cny=?, status='active', updated_at=?
       WHERE id=?`,
    ).run(
      input.name, input.coverUrl ?? null, normVisibility(input.visibility),
      normLicense(input.license), input.terms || '', clampRoyalty(input.royaltyCny), ts, existing.id,
    );
    return getIpToken(existing.id)!;
  }
  const id = 'ipt_' + nanoid(12);
  db.prepare(
    `INSERT INTO character_ip_tokens
      (id, character_id, owner_id, name, cover_url, visibility, license, terms, royalty_cny, status, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
  ).run(
    id, input.characterId, input.ownerId, input.name, input.coverUrl ?? null,
    normVisibility(input.visibility), normLicense(input.license), input.terms || '',
    clampRoyalty(input.royaltyCny), ts, ts,
  );
  return getIpToken(id)!;
}

export function getIpToken(id: string): IpToken | null {
  const r = db.prepare(`SELECT * FROM character_ip_tokens WHERE id = ?`).get(id) as any;
  return r ? mapTokenRow(r) : null;
}

/** owner 撤销 token. 撤销后除 owner 外不可再用. */
export function revokeIpToken(tokenId: string, ownerId: string): boolean {
  const t = getIpToken(tokenId);
  if (!t) return false;
  if (t.ownerId !== ownerId) throw new Error('revokeIpToken: 非所有者不能撤销');
  db.prepare(`UPDATE character_ip_tokens SET status='revoked', updated_at=? WHERE id=?`).run(now(), tokenId);
  return true;
}

/** 浏览市场: 默认只列 public + active. */
export function listMarketplaceTokens(opts: { limit?: number } = {}): IpToken[] {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 60));
  const rows = db
    .prepare(`SELECT * FROM character_ip_tokens WHERE visibility='public' AND status='active' ORDER BY use_count DESC, created_at DESC LIMIT ?`)
    .all(limit) as any[];
  return rows.map(mapTokenRow);
}

export function listOwnerTokens(ownerId: string): IpToken[] {
  const rows = db
    .prepare(`SELECT * FROM character_ip_tokens WHERE owner_id=? ORDER BY updated_at DESC`)
    .all(ownerId) as any[];
  return rows.map(mapTokenRow);
}

// ─── Grant 申请 / 审批 ─────────────────────────────────────────────────────

export function getGrant(tokenId: string, granteeId: string): IpGrant | null {
  const r = db
    .prepare(`SELECT * FROM character_ip_grants WHERE token_id=? AND grantee_id=?`)
    .get(tokenId, granteeId) as any;
  return r ? mapGrantRow(r) : null;
}

/** grantee 申请复用. 已存在的 grant 不重复建 (返回现有). owner 自己不需申请. */
export function requestGrant(tokenId: string, granteeId: string, message = ''): IpGrant {
  const token = getIpToken(tokenId);
  if (!token) throw new Error('requestGrant: token 不存在');
  if (token.ownerId === granteeId) throw new Error('requestGrant: 不能给自己的角色申请授权');
  const existing = getGrant(tokenId, granteeId);
  if (existing) return existing;
  const id = 'ipg_' + nanoid(12);
  db.prepare(
    `INSERT INTO character_ip_grants (id, token_id, grantee_id, status, use_count, message, created_at, decided_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, NULL)`,
  ).run(id, tokenId, granteeId, message.slice(0, 500), now());
  return getGrant(tokenId, granteeId)!;
}

/** owner 审批 grant (approve / reject). reject 写成 revoked. */
export function decideGrant(grantId: string, ownerId: string, approve: boolean): IpGrant {
  const r = db.prepare(`SELECT * FROM character_ip_grants WHERE id=?`).get(grantId) as any;
  if (!r) throw new Error('decideGrant: grant 不存在');
  const token = getIpToken(r.token_id);
  if (!token) throw new Error('decideGrant: token 不存在');
  if (token.ownerId !== ownerId) throw new Error('decideGrant: 只有 token 所有者能审批');
  const status: GrantStatus = approve ? 'approved' : 'revoked';
  db.prepare(`UPDATE character_ip_grants SET status=?, decided_at=? WHERE id=?`).run(status, now(), grantId);
  return mapGrantRow(db.prepare(`SELECT * FROM character_ip_grants WHERE id=?`).get(grantId));
}

/** owner 看自己所有 token 的待批 grant. */
export function listPendingGrantsForOwner(ownerId: string): Array<IpGrant & { tokenName: string }> {
  const rows = db.prepare(
    `SELECT g.*, t.name AS token_name FROM character_ip_grants g
     JOIN character_ip_tokens t ON t.id = g.token_id
     WHERE t.owner_id=? AND g.status='pending' ORDER BY g.created_at ASC`,
  ).all(ownerId) as any[];
  return rows.map((r) => ({ ...mapGrantRow(r), tokenName: r.token_name }));
}

// ─── 访问判定 + 计数 ───────────────────────────────────────────────────────

/** 综合查 token + grant, 返回某用户对某 token 的访问级别. */
export function checkAccess(tokenId: string, userId: string): { level: AccessLevel; token: IpToken | null } {
  const token = getIpToken(tokenId);
  if (!token) return { level: 'denied', token: null };
  const grant = getGrant(tokenId, userId);
  return { level: resolveAccess(token, grant, userId), token };
}

/** 记一次复用 (token.use_count++ 且若走 grant 则 grant.use_count++). 无权时返 false. */
export function recordTokenUse(tokenId: string, userId: string): boolean {
  const { level, token } = checkAccess(tokenId, userId);
  if (!token || !accessCanReuse(level)) return false;
  db.prepare(`UPDATE character_ip_tokens SET use_count=use_count+1 WHERE id=?`).run(tokenId);
  if (level === 'granted') {
    db.prepare(`UPDATE character_ip_grants SET use_count=use_count+1 WHERE token_id=? AND grantee_id=?`).run(tokenId, userId);
  }
  return true;
}

// ─── v4.0.1: 复用闭环 — 把授权角色导入自己的 character_library ──────────────────

export interface ImportCameoResult {
  ok: boolean;
  characterId?: string;
  alreadyImported?: boolean;
  error?: string;
}

/**
 * 把一个有权访问的 cameo token 对应的角色, 复制进 userId 自己的 character_library,
 * 之后就能像普通角色一样在创作流程里当参考图用 (闭环).
 *
 *   - 无访问权 → { ok:false }
 *   - 源角色不存在 → { ok:false }
 *   - 已导入过 (同 user + 同 source_token) → 返回现有 id, alreadyImported=true, 不重复计数
 *   - 首次导入 → 复制 + recordTokenUse + 返回新 id
 */
export function importCameoToLibrary(tokenId: string, userId: string): ImportCameoResult {
  const { level, token } = checkAccess(tokenId, userId);
  if (!token) return { ok: false, error: 'token 不存在' };
  if (!accessCanReuse(level)) return { ok: false, error: '无复用权限 (需作者授权)' };

  // dedup: 同一用户同一 token 已导入过就直接返回
  const existing = db
    .prepare(`SELECT id FROM character_library WHERE user_id=? AND source_token_id=?`)
    .get(userId, tokenId) as { id: string } | undefined;
  if (existing) return { ok: true, characterId: existing.id, alreadyImported: true };

  // 读源角色
  const src = db.prepare(`SELECT * FROM character_library WHERE id=?`).get(token.characterId) as any;
  if (!src) return { ok: false, error: '源角色已被删除' };

  const id = nanoid();
  const ts = now();
  db.prepare(
    `INSERT INTO character_library
      (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, source_token_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    id, userId,
    `${src.name} (联名)`,
    src.description || '', src.appearance || '',
    src.visual_tags || '[]', src.image_urls || '[]', src.style_keywords || '',
    tokenId, ts, ts,
  );

  recordTokenUse(tokenId, userId);
  return { ok: true, characterId: id, alreadyImported: false };
}
