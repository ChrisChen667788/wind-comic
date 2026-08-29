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
 * Auth: JWT 优先;**无 token 用 `__no_auth__` 哨兵**(v12.233 起),查到的永远是空集。
 *       v12.369:此处原注释还写着「缺 token 时回退到 DB 第一个用户(Demo)」——
 *       **代码在 v12.233 已经改掉了,注释没跟上**。一句与实现矛盾的注释比没有注释更糟:
 *       读的人会以为那个越权回落还在,进而据此做判断。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { findCharacterBibleByName } from '@/lib/repos/global-asset-repo'; // v9.0.3b: async, 双驱动

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
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

  // v12.373:**通用占位名不参与跨项目复用。**
  // v12.369 把 bible 回填好后,「主角」(79 个项目)「伙伴」(78 个)也会命中,
  // 界面提示「已找到「主角」—— 79 个历史项目用过 —— 一键复用」,
  // 而那 79 个项目彼此毫无关系。用户一点就把无关角色图套进来 ——
  // **比找不到更糟:找不到只是没帮上忙,套错是主动帮了倒忙。**
  const { isGenericCharacterName } = await import('@/lib/generic-character-names');
  if (isGenericCharacterName(name)) {
    return NextResponse.json({ found: false, reason: 'generic_name' });
  }

  const userId = resolveUserId(request);
  const hit = await findCharacterBibleByName(userId, name);
  if (!hit) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({ found: true, ...hit });
}
