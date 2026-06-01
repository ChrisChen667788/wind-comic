/**
 * v3.x — 项目协作邀请 API (跟旧的 read-only /share 区分开).
 *
 * POST /api/projects/[id]/invite  body: { role?, expiresInDays? }
 *   → { token, url, role, expiresAt } — 创建邀请 token
 *   403 → 仅 owner
 *
 * GET /api/projects/[id]/invite — 列当前项目所有未过期 token + collaborators
 *   → { tokens, collaborators }
 *
 * DELETE /api/projects/[id]/invite?token=xxx — 吊销 token (owner)
 * DELETE /api/projects/[id]/invite?userId=xxx — 踢出协作者 (owner, 不能踢自己)
 * PATCH /api/projects/[id]/invite body: { userId, role } — 改协作者角色 (owner)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import {
  createProjectShareToken,
  listShareTokensForProject,
  revokeProjectShareToken,
  listCollaborators,
  removeCollaborator,
  updateCollaboratorRole,
  type ProjectRole,
} from '@/lib/project-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string | null {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const fb = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  return fb?.id || null;
}

function isOwner(projectId: string, userId: string): boolean {
  const row = db.prepare(`SELECT user_id FROM projects WHERE id = ?`).get(projectId) as { user_id: string } | undefined;
  return !!row && row.user_id === userId;
}

function buildInviteUrl(request: Request, token: string): string {
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  return `${proto}://${host}/project-invite/${encodeURIComponent(token)}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isOwner(projectId, userId)) {
    return NextResponse.json({ error: '仅项目所有者可创建邀请' }, { status: 403 });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* allow empty */ }

  const role: ProjectRole =
    body.role === 'editor' || body.role === 'commenter' ? body.role : 'viewer';
  const expiresInDays = typeof body.expiresInDays === 'number' ? body.expiresInDays : null;

  const token = await createProjectShareToken({
    projectId, ownerUserId: userId, role,
    expiresInDays: expiresInDays === 0 ? null : expiresInDays,
  });
  return NextResponse.json({
    token: token.token,
    url: buildInviteUrl(request, token.token),
    role: token.role,
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isOwner(projectId, userId)) {
    return NextResponse.json({ error: '仅项目所有者可查看邀请列表' }, { status: 403 });
  }
  const tokens = await listShareTokensForProject(projectId);
  const collaborators = await listCollaborators(projectId);
  // 拼上 user info (name + avatar) 给 UI 渲染
  const collabsWithUser = collaborators.map((c) => {
    try {
      const u = db.prepare(
        `SELECT id, name, avatar_url FROM users WHERE id = ?`,
      ).get(c.userId) as { id: string; name: string; avatar_url: string | null } | undefined;
      return {
        ...c,
        userName: u?.name || '(未知用户)',
        userAvatarUrl: u?.avatar_url || null,
      };
    } catch {
      return { ...c, userName: '(未知用户)', userAvatarUrl: null };
    }
  });
  return NextResponse.json({
    tokens: tokens.map((t) => ({ ...t, url: buildInviteUrl(request, t.token) })),
    collaborators: collabsWithUser,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const token = request.nextUrl.searchParams.get('token');
  const userIdToRemove = request.nextUrl.searchParams.get('userId');

  if (token) {
    const ok = await revokeProjectShareToken(token, userId);
    if (!ok) return NextResponse.json({ error: 'token 不存在或非创建者' }, { status: 404 });
    return NextResponse.json({ revoked: true });
  }

  if (userIdToRemove) {
    const ok = await removeCollaborator(projectId, userIdToRemove, userId);
    if (!ok) return NextResponse.json({ error: '失败 — 仅 owner 可踢, 且不能踢自己' }, { status: 403 });
    return NextResponse.json({ removed: true });
  }

  return NextResponse.json({ error: '需要 token 或 userId 参数' }, { status: 400 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* allow empty */ }
  const targetUserId = String(body.userId || '');
  const newRole = String(body.role || '');
  if (!targetUserId || !['viewer', 'commenter', 'editor'].includes(newRole)) {
    return NextResponse.json({ error: '缺 userId 或 role 非法 (viewer/commenter/editor)' }, { status: 400 });
  }
  const ok = await updateCollaboratorRole(projectId, targetUserId, newRole as ProjectRole, userId);
  if (!ok) return NextResponse.json({ error: '失败 — 仅 owner 可改, 用户不存在' }, { status: 403 });
  return NextResponse.json({ updated: true, userId: targetUserId, role: newRole });
}
