/**
 * /api/cameo-ip  · v4.0
 *
 * GET  ?scope=market (默认) → 公开市场 token 列表
 *      ?scope=mine            → 当前用户发行的 token
 * POST 发行/更新一个角色的 IP token (body: { characterId, name, coverUrl?, visibility, license, terms?, royaltyCny? })
 *
 * Auth: POST 需登录; GET market 公开.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { issueIpToken, listMarketplaceTokens, listOwnerTokens } from '@/lib/repos/cameo-ip-repo'; // v9.0.3d: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') || 'market';
  if (scope === 'mine') {
    const payload = getUserFromRequest(request);
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ tokens: await listOwnerTokens(payload.sub) });
  }
  return NextResponse.json({ tokens: await listMarketplaceTokens({ limit: Number(url.searchParams.get('limit')) || 60 }) });
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const characterId = typeof body?.characterId === 'string' ? body.characterId : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!characterId || !name) {
    return NextResponse.json({ error: 'characterId 和 name 必填' }, { status: 400 });
  }
  try {
    const token = await issueIpToken({
      characterId,
      ownerId: payload.sub,
      name,
      coverUrl: body?.coverUrl ?? null,
      visibility: body?.visibility,
      license: body?.license,
      terms: body?.terms,
      royaltyCny: body?.royaltyCny,
    });
    return NextResponse.json({ token });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'issue failed' }, { status: 400 });
  }
}
