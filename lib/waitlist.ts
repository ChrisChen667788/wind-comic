/**
 * Waitlist 申请库 (v2.0 Sprint 0 D4)
 *
 * Beta 版 "申请内测" 功能 —— 用户提交邮箱 / 使用目的，管理员审批后发码。
 */

import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import type { WaitlistEntry } from '@/types/agents';
import { createInviteCode } from '@/lib/invite-codes';

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

export function createWaitlistEntry(input: CreateWaitlistInput): WaitlistEntry {
  const id = nanoid();
  const ts = now();
  db.prepare(
    `INSERT INTO waitlist (id, email, purpose, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.email.trim().toLowerCase(), input.purpose ?? '', input.source ?? null, 'pending', ts);
  return getWaitlistEntry(id)!;
}

export function getWaitlistEntry(id: string): WaitlistEntry | null {
  const row = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(id) as
    | WaitlistRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

export function findWaitlistByEmail(email: string): WaitlistEntry[] {
  const rows = db
    .prepare('SELECT * FROM waitlist WHERE email = ? ORDER BY created_at DESC')
    .all(email.trim().toLowerCase()) as WaitlistRow[];
  return rows.map(rowToEntry);
}

export function listWaitlistEntries(opts?: {
  status?: WaitlistEntry['status'];
  limit?: number;
}): WaitlistEntry[] {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status) {
    conds.push('status = ?');
    params.push(opts.status);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const rows = db
    .prepare(`SELECT * FROM waitlist ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as WaitlistRow[];
  return rows.map(rowToEntry);
}

/**
 * 审批通过：生成新邀请码 + 绑定到 waitlist 条目 + 标记 approved
 */
export function approveWaitlistEntry(
  id: string,
  adminId: string,
  source?: string,
): WaitlistEntry | null {
  const entry = getWaitlistEntry(id);
  if (!entry) return null;
  if (entry.status !== 'pending') {
    throw new Error(`Cannot approve entry in status: ${entry.status}`);
  }

  const invite = createInviteCode({
    createdBy: adminId,
    source: source ?? entry.source ?? 'waitlist',
  });

  const ts = now();
  db.prepare(
    `UPDATE waitlist SET status = 'approved', approved_at = ?, invite_code = ? WHERE id = ?`,
  ).run(ts, invite.code, id);
  return getWaitlistEntry(id);
}

export function rejectWaitlistEntry(id: string): WaitlistEntry | null {
  const entry = getWaitlistEntry(id);
  if (!entry) return null;
  db.prepare(`UPDATE waitlist SET status = 'rejected' WHERE id = ?`).run(id);
  return getWaitlistEntry(id);
}
