/**
 * GET/POST /api/usage/budget · v9.3.4 — 用户月预算护栏配置.
 *
 * GET  → { capCny, hardCapCny }  (null = 不设防)
 * POST { capCny, hardCapCny? } → 设/清(<=0 或空 → 清)→ 200 { capCny, hardCapCny }
 *
 * auth: getUserFromRequest; demo 无登录回退首用户(与 /api/usage 一致)。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../auth/lib';
import { getUserBudget, setUserBudget } from '@/lib/budget-enforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveUserId(request: Request): Promise<string> {
  const p = getUserFromRequest(request);
  if (p?.sub) return p.sub;
  const first = (await getDbDriver().get('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', [])) as { id: string } | undefined;
  return first?.id || 'demo-user';
}

function parseCny(v: unknown): number | null {
  return v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
}

export async function GET(request: Request) {
  const userId = await resolveUserId(request);
  return NextResponse.json(await getUserBudget(userId));
}

export async function POST(request: Request) {
  const userId = await resolveUserId(request);
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }
  await setUserBudget(userId, { capCny: parseCny(body?.capCny), hardCapCny: parseCny(body?.hardCapCny) });
  return NextResponse.json(await getUserBudget(userId));
}
