import { NextRequest } from 'next/server';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import type { MemberAllocation } from '@/lib/team-credits';

export const DEFAULT_POOL = 1000;

/** 解析主账号 id (无登录态时退回最早用户 / demo). */
export function ownerId(request: NextRequest): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const first = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  return first?.id || 'demo-user';
}

/** 读主账号的池 + 成员额度. */
export function loadTeam(owner: string): { pool: number; members: MemberAllocation[] } {
  const row = db.prepare('SELECT pool_credits, allocations FROM team_allocations WHERE owner_user_id = ?').get(owner) as
    | { pool_credits: number; allocations: string } | undefined;
  if (!row) return { pool: DEFAULT_POOL, members: [] };
  let members: MemberAllocation[] = [];
  try { members = JSON.parse(row.allocations || '[]'); } catch { members = []; }
  return { pool: row.pool_credits, members };
}

/** 写主账号的池 + 成员额度 (upsert). */
export function saveTeam(owner: string, pool: number, members: MemberAllocation[]): void {
  db.prepare(
    `INSERT INTO team_allocations (owner_user_id, pool_credits, allocations, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_user_id) DO UPDATE SET pool_credits = excluded.pool_credits, allocations = excluded.allocations, updated_at = excluded.updated_at`,
  ).run(owner, pool, JSON.stringify(members), now());
}
