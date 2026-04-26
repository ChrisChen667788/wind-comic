/**
 * GET /api/characters/bible/[name] · Sprint A.3 跨项目 Character Bible 查询
 *
 * 用户在创作工坊输入角色名时,前端 debounce 调本端点检查是否有历史 bible。
 * 找到了就在角色卡上提示"已找到「李长安」 — 一键复用?",一键填回 imageUrl + traits + role + cw。
 *
 * 入参: path :name (URL 编码的中文名)
 * 出参:
 *   200 → { found: false }                                            (没有历史)
 *        | { found: true, bible: CharacterBible, usedInProjectsCount: number }
 *   400 → { error: 'name required' }
 *
 * Auth: 与 /api/global-assets 一致 — JWT 优先,缺 token 时回退到 DB 第一个用户(Demo)。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { findCharacterBibleByName } from '@/lib/global-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  // 上限保护 — 避免恶意长 name
  if (name.length > 60) {
    return NextResponse.json({ error: 'name too long' }, { status: 400 });
  }

  const userId = resolveUserId(request);
  const hit = findCharacterBibleByName(userId, name);
  if (!hit) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({ found: true, ...hit });
}
