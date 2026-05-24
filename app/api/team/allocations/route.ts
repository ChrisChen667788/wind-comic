import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { poolSummary, type MemberAllocation } from '@/lib/team-credits';

export const runtime = 'nodejs';

const DEFAULT_POOL = 1000;

function ownerId(request: NextRequest): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const first = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  return first?.id || 'demo-user';
}

/** GET → 当前主账号的池 + 成员额度. */
export async function GET(request: NextRequest) {
  const owner = ownerId(request);
  const row = db.prepare('SELECT pool_credits, allocations FROM team_allocations WHERE owner_user_id = ?').get(owner) as
    | { pool_credits: number; allocations: string } | undefined;
  let members: MemberAllocation[] = [];
  let pool = DEFAULT_POOL;
  if (row) {
    pool = row.pool_credits;
    try { members = JSON.parse(row.allocations || '[]'); } catch { members = []; }
  }
  return NextResponse.json({ pool, members, summary: poolSummary(pool, members) });
}

/** PUT { pool, members } → 校验不超额后落库 (仅主账号). */
export async function PUT(request: NextRequest) {
  const owner = ownerId(request);
  const body = await request.json().catch(() => ({} as any));
  const pool = Number.isFinite(body?.pool) && body.pool >= 0 ? Math.floor(body.pool) : DEFAULT_POOL;
  const members: MemberAllocation[] = Array.isArray(body?.members)
    ? body.members
        .filter((m: any) => m && typeof m.id === 'string' && m.id.trim())
        .map((m: any) => ({
          id: String(m.id).trim(),
          name: typeof m.name === 'string' ? m.name.slice(0, 60) : undefined,
          role: ['owner', 'admin', 'member'].includes(m.role) ? m.role : 'member',
          allocated: Math.max(0, Math.floor(Number(m.allocated) || 0)),
          used: Math.max(0, Math.floor(Number(m.used) || 0)),
        }))
    : [];

  const summary = poolSummary(pool, members);
  if (summary.overAllocated) {
    return NextResponse.json({ message: `分配总额 ${summary.allocated} 超过团队池 ${pool}` }, { status: 400 });
  }

  db.prepare(
    `INSERT INTO team_allocations (owner_user_id, pool_credits, allocations, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_user_id) DO UPDATE SET pool_credits = excluded.pool_credits, allocations = excluded.allocations, updated_at = excluded.updated_at`,
  ).run(owner, pool, JSON.stringify(members), now());

  return NextResponse.json({ pool, members, summary, saved: true });
}
