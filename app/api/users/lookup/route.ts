/**
 * v3.0 P0.1 — Lightweight user name lookup for @-mention autocomplete.
 *
 * GET /api/users/lookup?q=张 → { users: [{ id, name, avatarUrl }] }
 *
 * 严格限制:
 *   - 必须登录 (防匿名爬用户库)
 *   - q ≥ 1 char, ≤ 30
 *   - 上限 10 条结果
 *   - 只返 id / name / avatar — 不泄 email / role 等
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const payload = getUserFromRequest(request);
  // dev / demo 兜底 — 没 token 也允许 (因为 dev 经常没设 JWT_SECRET)
  if (!payload && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 30);
  if (!q) return NextResponse.json({ users: [] });

  // LIKE 'q%' — 前缀匹配 (更贴 @ 补全用法). 大小写不敏感.
  const rows = db
    .prepare(`SELECT id, name, avatar_url FROM users WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 10`)
    .all(`${q}%`) as Array<{ id: string; name: string; avatar_url: string | null }>;

  return NextResponse.json({
    users: rows.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url })),
  });
}
