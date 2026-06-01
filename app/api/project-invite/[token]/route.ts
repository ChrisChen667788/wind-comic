/**
 * GET /api/project-invite/[token] — 公开读邀请详情 (项目预览, 不要 auth)
 *   → { project: { id, title, description, coverUrl }, role, owner: { name, avatarUrl } }
 *   404 → token 无效 / 过期
 *
 * POST /api/project-invite/[token] — 用户接受邀请 (需 auth, 写入 project_collaborators)
 *   → { ok: true, projectId, role }
 *   401 → 未登录
 *   400 → 拒绝原因 (owner 自己 / 已是 collaborator 升级等)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import {
  getProjectShareToken,
  incrementShareTokenViewCount,
  acceptProjectInvite,
} from '@/lib/project-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const t = await getProjectShareToken(token);
  if (!t) {
    return NextResponse.json({ error: '邀请链接无效或已过期' }, { status: 404 });
  }
  // 取 project + owner 信息
  const proj = db.prepare(
    `SELECT id, title, description, cover_urls FROM projects WHERE id = ?`,
  ).get(t.projectId) as { id: string; title: string; description: string; cover_urls: string } | undefined;
  if (!proj) {
    return NextResponse.json({ error: '项目已删除' }, { status: 404 });
  }
  let coverUrl: string | null = null;
  try {
    const arr = JSON.parse(proj.cover_urls || '[]');
    if (Array.isArray(arr) && arr[0]) coverUrl = arr[0];
  } catch { /* ignore */ }
  const owner = db.prepare(`SELECT name, avatar_url FROM users WHERE id = ?`).get(t.ownerUserId) as
    | { name: string; avatar_url: string | null }
    | undefined;

  await incrementShareTokenViewCount(token);
  return NextResponse.json({
    project: {
      id: proj.id,
      title: proj.title,
      description: proj.description,
      coverUrl,
    },
    role: t.role,
    expiresAt: t.expiresAt,
    owner: owner ? { name: owner.name, avatarUrl: owner.avatar_url } : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) {
    return NextResponse.json({ error: '需要登录后接受邀请' }, { status: 401 });
  }
  const result = await acceptProjectInvite({ token, userId: payload.sub });
  if (!result.ok) {
    return NextResponse.json({ error: result.error || '接受失败' }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    projectId: result.collaborator?.projectId,
    role: result.collaborator?.role,
  });
}
