/**
 * Waitlist 申请库 (v2.0 Sprint 0 D4)
 *
 * Beta 版 "申请内测" 功能 —— 用户提交邮箱 / 使用目的，管理员审批后发码。
 */

// v9.0.4: 全量异步化 (走 DbDriver, 双驱动); createInviteCode 改走 invite-repo (清 v9.0.3 defer)
import { getDbDriver } from '@/lib/db-driver';
import { nanoid } from 'nanoid';
import type { WaitlistEntry } from '@/types/agents';
import { createInviteCode } from '@/lib/repos/invite-repo';

interface WaitlistRow {
  id: string;
  email: string;
  purpose: string;
  source: string | null;
  status: string;
  approved_at: string | null;
  invite_code: string | null;
  created_at: string;
}

function rowToEntry(row: WaitlistRow): WaitlistEntry {
  return {
    id: row.id,
    email: row.email,
    purpose: row.purpose,
    source: row.source ?? undefined,
    status: row.status as WaitlistEntry['status'],
    approvedAt: row.approved_at ?? undefined,
    inviteCode: row.invite_code ?? undefined,
    createdAt: row.created_at,
  };
}

export interface CreateWaitlistInput {
  email: string;
  purpose?: string;
  source?: string;
}

export async function createWaitlistEntry(input: CreateWaitlistInput): Promise<WaitlistEntry> {
  const id = nanoid();
  const ts = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO waitlist (id, email, purpose, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.email.trim().toLowerCase(), input.purpose ?? '', input.source ?? null, 'pending', ts],
  );
  return (await getWaitlistEntry(id))!;
}

export async function getWaitlistEntry(id: string): Promise<WaitlistEntry | null> {
  const row = await getDbDriver().get<WaitlistRow>('SELECT * FROM waitlist WHERE id = ?', [id]);
  return row ? rowToEntry(row) : null;
}

export async function findWaitlistByEmail(email: string): Promise<WaitlistEntry[]> {
  const rows = await getDbDriver().query<WaitlistRow>(
    'SELECT * FROM waitlist WHERE email = ? ORDER BY created_at DESC', [email.trim().toLowerCase()],
  );
  return rows.map(rowToEntry);
}

export async function listWaitlistEntries(opts?: {
  status?: WaitlistEntry['status'];
  limit?: number;
}): Promise<WaitlistEntry[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status) { conds.push('status = ?'); params.push(opts.status); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const rows = await getDbDriver().query<WaitlistRow>(
    `SELECT * FROM waitlist ${where} ORDER BY created_at DESC LIMIT ?`, [...params, limit],
  );
  return rows.map(rowToEntry);
}

/** 审批通过: 生成新邀请码 + 绑定 + 标记 approved. */
export async function approveWaitlistEntry(
  id: string,
  adminId: string,
  source?: string,
): Promise<WaitlistEntry | null> {
  const entry = await getWaitlistEntry(id);
  if (!entry) return null;
  if (entry.status !== 'pending') {
    throw new Error(`Cannot approve entry in status: ${entry.status}`);
  }
  const invite = await createInviteCode({
    createdBy: adminId,
    source: source ?? entry.source ?? 'waitlist',
  });
  await getDbDriver().run(
    `UPDATE waitlist SET status = 'approved', approved_at = ?, invite_code = ? WHERE id = ?`,
    [new Date().toISOString(), invite.code, id],
  );
  return getWaitlistEntry(id);
}

export async function rejectWaitlistEntry(id: string): Promise<WaitlistEntry | null> {
  const entry = await getWaitlistEntry(id);
  if (!entry) return null;
  await getDbDriver().run(`UPDATE waitlist SET status = 'rejected' WHERE id = ?`, [id]);
  return getWaitlistEntry(id);
}
