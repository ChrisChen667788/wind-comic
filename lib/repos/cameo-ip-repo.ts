/**
 * v9.0.3d — Cameo IP 经济仓库 (async, 走 DbDriver).
 *
 * PG 迁移阶段十一新建 repo 第四个 (character 域收尾): character_ip_tokens / character_ip_grants
 * + importCameoToLibrary 写 character_library。SQLite/PG 双驱动。
 * 纯权限逻辑 (resolveAccess/accessCanReuse/licenseAllowsReuse) 仍从 lib/cameo-ip 引 (单测核心,
 * 不重复); 旧同步 DB 版保留在 lib/cameo-ip.ts 给其既有单测。
 *
 * 单测: tests/v9-0-3d-cameo-ip-repo.test.ts.
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';
import {
  resolveAccess, accessCanReuse,
  type IpToken, type IpGrant, type IpVisibility, type IpLicense, type AccessLevel, type GrantStatus,
} from '../cameo-ip';

// ─── 内部纯助手 (从 lib/cameo-ip 复制, 保持自洽; 都是稳定小函数) ───
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

/** 发行 / 更新一个角色的 IP token (一角色一 token, UPSERT). */
export async function issueIpToken(input: IssueTokenInput): Promise<IpToken> {
  const d = getDbDriver();
  const existing = await d.get<any>(`SELECT * FROM character_ip_tokens WHERE character_id = ?`, [input.characterId]);
  const ts = new Date().toISOString();
  if (existing) {
    if (existing.owner_id !== input.ownerId) throw new Error('issueIpToken: 只有角色所有者能发/改 IP token');
    await d.run(
      `UPDATE character_ip_tokens SET name=?, cover_url=?, visibility=?, license=?, terms=?, royalty_cny=?, status='active', updated_at=? WHERE id=?`,
      [input.name, input.coverUrl ?? null, normVisibility(input.visibility), normLicense(input.license), input.terms || '', clampRoyalty(input.royaltyCny), ts, existing.id],
    );
    return (await getIpToken(existing.id))!;
  }
  const id = 'ipt_' + nanoid(12);
  await d.run(
    `INSERT INTO character_ip_tokens (id, character_id, owner_id, name, cover_url, visibility, license, terms, royalty_cny, status, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
    [id, input.characterId, input.ownerId, input.name, input.coverUrl ?? null, normVisibility(input.visibility), normLicense(input.license), input.terms || '', clampRoyalty(input.royaltyCny), ts, ts],
  );
  return (await getIpToken(id))!;
}

export async function getIpToken(id: string): Promise<IpToken | null> {
  const r = await getDbDriver().get<any>(`SELECT * FROM character_ip_tokens WHERE id = ?`, [id]);
  return r ? mapTokenRow(r) : null;
}

export async function revokeIpToken(tokenId: string, ownerId: string): Promise<boolean> {
  const t = await getIpToken(tokenId);
  if (!t) return false;
  if (t.ownerId !== ownerId) throw new Error('revokeIpToken: 非所有者不能撤销');
  await getDbDriver().run(`UPDATE character_ip_tokens SET status='revoked', updated_at=? WHERE id=?`, [new Date().toISOString(), tokenId]);
  await fanOutTokenInvalidation(t, 'revoked'); // v12.2.7 反向同步:扇出失效到导入方
  return true;
}

/**
 * v12.2.7 IP 反向同步:token 被撤销/更新时,找出所有导入它的 character_library 行
 * (source_token_id = tokenId),标 stale=1,并给行主人发通知(铃铛 + SSE)。
 * best-effort:任一步失败不影响撤销主流程。返回受影响的导入行数。
 */
export async function fanOutTokenInvalidation(token: IpToken, event: 'revoked' | 'updated'): Promise<number> {
  try {
    const driver = getDbDriver();
    const rows = await driver.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM character_library WHERE source_token_id = ?', [token.id],
    );
    if (rows.length === 0) return 0;
    await driver.run('UPDATE character_library SET stale = 1 WHERE source_token_id = ?', [token.id]);
    const { createNotification } = await import('./notification-repo');
    const { emitNotification } = await import('../event-bus');
    const verb = event === 'revoked' ? '撤销了授权' : '更新了授权';
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.user_id || seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      try {
        await createNotification({
          recipientUserId: r.user_id,
          type: `ip_${event}`,
          sourceUserId: token.ownerId,
          sourceUserName: 'IP 授权',
          preview: `你复用的角色「${token.name}」作者${verb},该角色已标记为需复核(可能不再可商用)。`,
        });
        emitNotification(r.user_id, { kind: `ip_${event}`, tokenId: token.id });
      } catch { /* 单条通知失败跳过 */ }
    }
    return rows.length;
  } catch (e) {
    console.warn('[cameo-ip] fanOutTokenInvalidation failed (non-blocking):', e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function listMarketplaceTokens(opts: { limit?: number } = {}): Promise<IpToken[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 60));
  const rows = await getDbDriver().query<any>(
    `SELECT * FROM character_ip_tokens WHERE visibility='public' AND status='active' ORDER BY use_count DESC, created_at DESC LIMIT ?`, [limit],
  );
  return rows.map(mapTokenRow);
}

export async function listOwnerTokens(ownerId: string): Promise<IpToken[]> {
  const rows = await getDbDriver().query<any>(`SELECT * FROM character_ip_tokens WHERE owner_id=? ORDER BY updated_at DESC`, [ownerId]);
  return rows.map(mapTokenRow);
}

// ─── Grant 申请 / 审批 ─────────────────────────────────────────────────────

export async function getGrant(tokenId: string, granteeId: string): Promise<IpGrant | null> {
  const r = await getDbDriver().get<any>(`SELECT * FROM character_ip_grants WHERE token_id=? AND grantee_id=?`, [tokenId, granteeId]);
  return r ? mapGrantRow(r) : null;
}

/** grantee 申请复用 (已存在不重复建). */
export async function requestGrant(tokenId: string, granteeId: string, message = ''): Promise<IpGrant> {
  const token = await getIpToken(tokenId);
  if (!token) throw new Error('requestGrant: token 不存在');
  if (token.ownerId === granteeId) throw new Error('requestGrant: 不能给自己的角色申请授权');
  const existing = await getGrant(tokenId, granteeId);
  if (existing) return existing;
  const id = 'ipg_' + nanoid(12);
  await getDbDriver().run(
    `INSERT INTO character_ip_grants (id, token_id, grantee_id, status, use_count, message, created_at, decided_at) VALUES (?, ?, ?, 'pending', 0, ?, ?, NULL)`,
    [id, tokenId, granteeId, message.slice(0, 500), new Date().toISOString()],
  );
  return (await getGrant(tokenId, granteeId))!;
}

/** owner 审批 grant (approve→approved / reject→revoked). */
export async function decideGrant(grantId: string, ownerId: string, approve: boolean): Promise<IpGrant> {
  const d = getDbDriver();
  const r = await d.get<any>(`SELECT * FROM character_ip_grants WHERE id=?`, [grantId]);
  if (!r) throw new Error('decideGrant: grant 不存在');
  const token = await getIpToken(r.token_id);
  if (!token) throw new Error('decideGrant: token 不存在');
  if (token.ownerId !== ownerId) throw new Error('decideGrant: 只有 token 所有者能审批');
  const status: GrantStatus = approve ? 'approved' : 'revoked';
  await d.run(`UPDATE character_ip_grants SET status=?, decided_at=? WHERE id=?`, [status, new Date().toISOString(), grantId]);
  return mapGrantRow(await d.get<any>(`SELECT * FROM character_ip_grants WHERE id=?`, [grantId]));
}

export async function listPendingGrantsForOwner(ownerId: string): Promise<Array<IpGrant & { tokenName: string }>> {
  const rows = await getDbDriver().query<any>(
    `SELECT g.*, t.name AS token_name FROM character_ip_grants g JOIN character_ip_tokens t ON t.id = g.token_id
     WHERE t.owner_id=? AND g.status='pending' ORDER BY g.created_at ASC`, [ownerId],
  );
  return rows.map((r) => ({ ...mapGrantRow(r), tokenName: r.token_name }));
}

// ─── 访问判定 + 计数 ───────────────────────────────────────────────────────

export async function checkAccess(tokenId: string, userId: string): Promise<{ level: AccessLevel; token: IpToken | null }> {
  const token = await getIpToken(tokenId);
  if (!token) return { level: 'denied', token: null };
  const grant = await getGrant(tokenId, userId);
  return { level: resolveAccess(token, grant, userId), token };
}

/** 记一次复用 (token.use_count++ 且若走 grant 则 grant.use_count++). 无权 → false. */
export async function recordTokenUse(tokenId: string, userId: string): Promise<boolean> {
  const d = getDbDriver();
  const { level, token } = await checkAccess(tokenId, userId);
  if (!token || !accessCanReuse(level)) return false;
  await d.run(`UPDATE character_ip_tokens SET use_count=use_count+1 WHERE id=?`, [tokenId]);
  if (level === 'granted') {
    await d.run(`UPDATE character_ip_grants SET use_count=use_count+1 WHERE token_id=? AND grantee_id=?`, [tokenId, userId]);
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

export async function importCameoToLibrary(tokenId: string, userId: string): Promise<ImportCameoResult> {
  const d = getDbDriver();
  const { level, token } = await checkAccess(tokenId, userId);
  if (!token) return { ok: false, error: 'token 不存在' };
  if (!accessCanReuse(level)) return { ok: false, error: '无复用权限 (需作者授权)' };

  const existing = await d.get<{ id: string }>(`SELECT id FROM character_library WHERE user_id=? AND source_token_id=?`, [userId, tokenId]);
  if (existing) return { ok: true, characterId: existing.id, alreadyImported: true };

  const src = await d.get<any>(`SELECT * FROM character_library WHERE id=?`, [token.characterId]);
  if (!src) return { ok: false, error: '源角色已被删除' };

  const id = nanoid();
  const ts = new Date().toISOString();
  await d.run(
    `INSERT INTO character_library (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, source_token_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [id, userId, `${src.name} (联名)`, src.description || '', src.appearance || '', src.visual_tags || '[]', src.image_urls || '[]', src.style_keywords || '', tokenId, ts, ts],
  );
  await recordTokenUse(tokenId, userId);
  return { ok: true, characterId: id, alreadyImported: false };
}
