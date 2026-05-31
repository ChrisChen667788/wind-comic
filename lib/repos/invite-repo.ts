/**
 * v9.0.3 — 邀请码仓库 (async, 走 DbDriver).
 *
 * PG 迁移阶段十一新建 repo 第一个: invite_codes 域. SQLite/PG 双驱动, 占位符统一 `?`.
 * 路由可达的写路径走这里; `lib/invite-codes.ts` 的同步版保留给其既有单测 (非路由可达)。
 *
 *   - 管理端: createInviteCode / generateInviteCodes / listInviteCodes / revokeInviteCode
 *   - 注册端: consumeInviteCodeTx (tx 作用域, 由 register 的 getDbDriver().transaction 包裹,
 *             与插 user 同事务原子) —— 从 lib/invite-codes 迁来, 是 PG 注册闭环的关键。
 *   - 校验:  validateInviteCode (只读)
 *
 * 单测: tests/v9-0-3-invite-repo.test.ts.
 */
import { getDbDriver, type DbExecutor } from '../db-driver';
import type { InviteCode } from '@/types/agents';

// 排除 0/O/1/I/L 的 Crockford 风格字符集
const CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 生成一个随机码: prefix + 6 位. (index 变随机源, 不依赖 Math.random 的可测性). */
export function generateRandomCode(prefix = 'BETA'): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return `${prefix}${suffix}`;
}

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

export type InviteCodeError = 'NOT_FOUND' | 'ALREADY_USED' | 'EXPIRED' | 'REVOKED' | 'INVALID';

export interface ValidateResult {
  ok: boolean;
  error?: InviteCodeError;
  invite?: InviteCode;
}

export interface CreateInviteCodeInput {
  code?: string;
  source?: string;
  expiresAt?: string;
  createdBy: string;
}

export async function getInviteCode(code: string): Promise<InviteCode | null> {
  const row = await getDbDriver().get<InviteCodeRow>(
    'SELECT * FROM invite_codes WHERE code = ?', [code.toUpperCase()],
  );
  return row ? rowToInvite(row) : null;
}

/** 创建单个码 (显式指定或随机生成, 自动重试碰撞). */
export async function createInviteCode(input: CreateInviteCodeInput): Promise<InviteCode> {
  const driver = getDbDriver();
  const ts = new Date().toISOString();
  const maxTries = 5;
  for (let i = 0; i < maxTries; i++) {
    const code = (input.code || generateRandomCode()).toUpperCase();
    try {
      await driver.run(
        `INSERT INTO invite_codes (code, source, status, used_by_user_id, used_at, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, input.source ?? null, 'unused', null, null, input.expiresAt ?? null, input.createdBy, ts],
      );
      const row = await getInviteCode(code);
      if (!row) throw new Error('createInviteCode: 插入后读取失败');
      return row;
    } catch (e) {
      // PRIMARY KEY 冲突 → 重试; 显式给了 code 则直接抛
      if (input.code) throw e;
      if (i === maxTries - 1) throw new Error('Failed to generate unique invite code');
    }
  }
  throw new Error('unreachable');
}

/** 批量生成 n 个码. */
export async function generateInviteCodes(n: number, createdBy: string, source?: string): Promise<InviteCode[]> {
  const out: InviteCode[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await createInviteCode({ createdBy, source }));
  }
  return out;
}

export async function listInviteCodes(opts?: {
  status?: InviteCode['status'];
  source?: string;
  limit?: number;
}): Promise<InviteCode[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status) { conds.push('status = ?'); params.push(opts.status); }
  if (opts?.source) { conds.push('source = ?'); params.push(opts.source); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const rows = await getDbDriver().query<InviteCodeRow>(
    `SELECT * FROM invite_codes ${where} ORDER BY created_at DESC LIMIT ?`, [...params, limit],
  );
  return rows.map(rowToInvite);
}

/** 只校验不占用 (注册页"验证"按钮). */
export async function validateInviteCode(code: string): Promise<ValidateResult> {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, error: 'INVALID' };
  }
  const invite = await getInviteCode(code);
  if (!invite) return { ok: false, error: 'NOT_FOUND' };
  if (invite.status === 'used') return { ok: false, error: 'ALREADY_USED' };
  if (invite.status === 'revoked') return { ok: false, error: 'REVOKED' };
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'EXPIRED' };
  }
  return { ok: true, invite };
}

/**
 * 事务作用域版消费邀请码 — 在调用方的 DbDriver 事务内执行 (tx executor),
 * 让"插 user + 消费邀请码"真正原子. 不自己开/提交事务, 由调用方 transaction(fn) 包裹。
 */
export async function consumeInviteCodeTx(
  tx: DbExecutor,
  code: string,
  userId: string,
): Promise<ValidateResult> {
  const c = code ? code.trim().toUpperCase() : '';
  if (!c) return { ok: false, error: 'INVALID' };
  const row = await tx.get<InviteCodeRow>('SELECT * FROM invite_codes WHERE code = ?', [c]);
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (row.status === 'used') return { ok: false, error: 'ALREADY_USED' };
  if (row.status === 'revoked') return { ok: false, error: 'REVOKED' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await tx.run('UPDATE invite_codes SET status = ? WHERE code = ?', ['expired', c]);
    return { ok: false, error: 'EXPIRED' };
  }
  await tx.run(
    `UPDATE invite_codes SET status = ?, used_by_user_id = ?, used_at = ? WHERE code = ? AND status = 'unused'`,
    ['used', userId, new Date().toISOString(), c],
  );
  const updated = await tx.get<InviteCodeRow>('SELECT * FROM invite_codes WHERE code = ?', [c]);
  return { ok: true, invite: rowToInvite(updated!) };
}

/** 撤销码 (未使用的才能撤). 返回是否改动. */
export async function revokeInviteCode(code: string): Promise<boolean> {
  const r = await getDbDriver().run(
    "UPDATE invite_codes SET status = 'revoked' WHERE code = ? AND status != 'used'",
    [code.toUpperCase()],
  );
  return r.changes > 0;
}

/**
 * 是否启用 Beta 邀请码门禁 —— 读环境变量. 默认开启;
 * `BETA_INVITE_REQUIRED=false` 可关 (开发环境). (纯 env 读, 与驱动无关.)
 */
export function isInviteRequired(): boolean {
  const v = (process.env.BETA_INVITE_REQUIRED ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}
