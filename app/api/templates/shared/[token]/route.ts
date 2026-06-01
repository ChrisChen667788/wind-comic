/**
 * GET /api/templates/shared/[token] · v2.18 P2.3 — 公开读取分享的模板
 *   不要求 auth, 任何人能看 (这是分享的本意).
 *   每次 GET 自动 +view_count.
 *   200 → { template: { ...metadata fields... }, ownerName?, viewCount, cloneCount, createdAt }
 *   404 → token 不存在 / 已过期 / 背后 asset 已删
 *
 * POST /api/templates/shared/[token]/clone — 克隆到当前用户的个人模板库
 *   要求 auth (没登录的用户得先登录才能克隆).
 *   200 → { newAssetId, newAssetName }
 *   404 → token 不存在
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getTemplateAssetForToken,
  incrementViewCount,
} from '@/lib/template-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveOwnerName(userId: string): string | null {
  try {
    const row = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as
      | { name: string }
      | undefined;
    return row?.name || null;
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getTemplateAssetForToken(token);
  if (!found) {
    return NextResponse.json({ error: '分享链接不存在或已过期' }, { status: 404 });
  }
  // 公开读取 +view_count (失败容忍)
  await incrementViewCount(token);
  const ownerName = resolveOwnerName(found.token.ownerUserId);
  return NextResponse.json({
    token,
    template: {
      // 用 asset.name + metadata 重组成 StoryTemplate-shape
      id: `shared-${found.token.assetId}`,
      name: found.asset.name,
      description: found.asset.description,
      ...(found.asset.metadata || {}),
    },
    ownerName,
    ownerUserId: found.token.ownerUserId,
    viewCount: found.token.viewCount + 1, // +1 因为本次 view 还没 commit 到 DB 的 row
    cloneCount: found.token.cloneCount,
    createdAt: found.token.createdAt,
  });
}
