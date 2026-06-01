import { NextRequest, NextResponse } from 'next/server';
import { poolSummary, type MemberAllocation } from '@/lib/team-credits';
import { ownerId, loadTeam, saveTeam, DEFAULT_POOL } from '../lib'; // v9.0.4: 复用 team/lib (双驱动), 去重

export const runtime = 'nodejs';

/** GET → 当前主账号的池 + 成员额度. */
export async function GET(request: NextRequest) {
  const owner = await ownerId(request);
  const { pool, members } = await loadTeam(owner);
  return NextResponse.json({ pool, members, summary: poolSummary(pool, members) });
}

/** PUT { pool, members } → 校验不超额后落库 (仅主账号). */
export async function PUT(request: NextRequest) {
  const owner = await ownerId(request);
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

  await saveTeam(owner, pool, members);

  return NextResponse.json({ pool, members, summary, saved: true });
}
