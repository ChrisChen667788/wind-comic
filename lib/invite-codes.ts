/**
 * Beta 邀请码库 (v2.0 Sprint 0 D4)
 *
 * 对应 `invite_codes` 表。用于 Beta 版准入控制。
 *
 * 工作流：
 *   1. 管理员调用 `generateInviteCodes(n, source)` 批量生成码
 *   2. 用户注册时传 `inviteCode`，`consumeInviteCode` 原子性校验 + 占用
 *   3. 管理员可 `revokeInviteCode` / `listInviteCodes`
 *
 * 码格式：`BETA` 前缀 + 6 位大写字母数字（排除易混字符 0/O/1/I/L）
 */

import { db, now } from '@/lib/db';
import type { InviteCode } from '@/types/agents';

// ──────────────────────────────────────────────────────────
// 码生成
// ──────────────────────────────────────────────────────────

// 排除 0/O/1/I/L 的 Crockford 风格字符集
const CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 生成一个随机码：BETA + 6 位 */
export function generateRandomCode(prefix = 'BETA'): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return `${prefix}${suffix}`;
}

// ──────────────────────────────────────────────────────────
// Row ↔ Entity
// ──────────────────────────────────────────────────────────

interface InviteCodeRow {
  code: string;
  source: string | null;
  status: string;
  used_by_user_id: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
}

function rowToInvite(row: InviteCodeRow): InviteCode {
  return {
    code: row.code,
    source: row.source ?? undefined,
    status: row.status as InviteCode['status'],
    usedByUserId: row.used_by_user_id ?? undefined,
    usedAt: row.used_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ──────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────

export interface CreateInviteCodeInput {
  code?: string;
  source?: string;
  expiresAt?: string;
  createdBy: string;
}

/** 创建单个码（显式指定或随机生成，自动重试碰撞） */
export function createInviteCode(input: CreateInviteCodeInput): InviteCode {
  const ts = now();
  const maxTries = 5;

  for (let i = 0; i < maxTries; i++) {
    const code = (input.code || generateRandomCode()).toUpperCase();
    try {
      db.prepare(
        `INSERT INTO invite_codes
          (code, source, status, used_by_user_id, used_at, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        code,
        input.source ?? null,
        'unused',
        null,
        null,
        input.expiresAt ?? null,
        input.createdBy,
        ts,
      );
      return getInviteCode(code)!;
    } catch (e) {
      // PRIMARY KEY 冲突 → 重试；若显式给了 code 则直接抛
      if (input.code) throw e;
      if (i === maxTries - 1) throw new Error('Failed to generate unique invite code');
    }
  }
  throw new Error('unreachable');
}

/** 批量生成 n 个码 */
export function generateInviteCodes(n: number, createdBy: string, source?: string): InviteCode[] {
  const out: InviteCode[] = [];
  for (let i = 0; i < n; i++) {
    out.push(createInviteCode({ createdBy, source }));
  }
  return out;
}

export function getInviteCode(code: string): InviteCode | null {
  const row = db
    .prepare('SELECT * FROM invite_codes WHERE code = ?')
    .get(code.toUpperCase()) as InviteCodeRow | undefined;
  return row ? rowToInvite(row) : null;
}

export function listInviteCodes(opts?: {
  status?: InviteCode['status'];
  source?: string;
  limit?: number;
}): InviteCode[] {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status) {
    conds.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.source) {
    conds.push('source = ?');
    params.push(opts.source);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const rows = db
    .prepare(`SELECT * FROM invite_codes ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as InviteCodeRow[];
  return rows.map(rowToInvite);
}

// ──────────────────────────────────────────────────────────
// 消费 / 校验 / 撤销
// ──────────────────────────────────────────────────────────

export type InviteCodeError =
  | 'NOT_FOUND'
  | 'ALREADY_USED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'INVALID';

export interface ValidateResult {
  ok: boolean;
  error?: InviteCodeError;
  invite?: InviteCode;
}

/** 只校验不占用（用于注册页点 “验证” 按钮的场景） */
export function validateInviteCode(code: string): ValidateResult {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, error: 'INVALID' };
  }
  const invite = getInviteCode(code);
  if (!invite) return { ok: false, error: 'NOT_FOUND' };
  if (invite.status === 'used') return { ok: false, error: 'ALREADY_USED' };
  if (invite.status === 'revoked') return { ok: false, error: 'REVOKED' };
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'EXPIRED' };
  }
  return { ok: true, invite };
}

/**
 * 原子性消费邀请码：校验 + 占用 + 绑定 userId
 * 用 transaction 保证并发安全。
 */
export function consumeInviteCode(code: string, userId: string): ValidateResult {
  const normalized = code ? code.trim().toUpperCase() : '';
  if (!normalized) return { ok: false, error: 'INVALID' };

  const tx = db.transaction((c: string, uid: string): ValidateResult => {
    const row = db
      .prepare('SELECT * FROM invite_codes WHERE code = ?')
      .get(c) as InviteCodeRow | undefined;
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    if (row.status === 'used') return { ok: false, error: 'ALREADY_USED' };
    if (row.status === 'revoked') return { ok: false, error: 'REVOKED' };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      // 同时把状态改成 expired，避免每次都 O(1) 过期检查
      db.prepare('UPDATE invite_codes SET status = ? WHERE code = ?').run('expired', c);
      return { ok: false, error: 'EXPIRED' };
    }
    const ts = now();
    db.prepare(
      `UPDATE invite_codes
         SET status = ?, used_by_user_id = ?, used_at = ?
       WHERE code = ? AND status = 'unused'`,
    ).run('used', uid, ts, c);

    const updated = db
      .prepare('SELECT * FROM invite_codes WHERE code = ?')
      .get(c) as InviteCodeRow;
    return { ok: true, invite: rowToInvite(updated) };
  });

  return tx(normalized, userId);
}

export function revokeInviteCode(code: string): boolean {
  const res = db
    .prepare("UPDATE invite_codes SET status = 'revoked' WHERE code = ? AND status != 'used'")
    .run(code.toUpperCase());
  return res.changes > 0;
}

/**
 * 是否启用 Beta 邀请码门禁 —— 读环境变量。
 * 默认开启；设置 `BETA_INVITE_REQUIRED=false` 可关闭（开发环境）。
 */
export function isInviteRequired(): boolean {
  const v = (process.env.BETA_INVITE_REQUIRED ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}
