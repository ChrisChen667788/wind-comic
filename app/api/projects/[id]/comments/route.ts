/**
 * v3.0 P0.1 — Comments REST for a project.
 *
 * GET    /api/projects/[id]/comments?targetType=&targetId=&limit=
 *   公开读 (= 任意登录用户可读评论流) — 项目级评论的访问控制走 project.user_id 校验
 *   200 → { comments: CommentRow[] }
 *
 * POST   /api/projects/[id]/comments
 *   body: { targetType, targetId, content, parentId? }
 *   auth 必需 — 走 author = current user
 *   200 → { comment: CommentRow, notifiedUserIds: string[] }
 *   400 → 缺字段 / content 太长
 *   401 → 未登录
 *
 * DELETE /api/projects/[id]/comments?commentId=xxx
 *   auth 必需 — 软删, 只允许作者本人删
 *   200 → { deleted: true }
 *   403 → 不是作者
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, getUserById } from '../../../auth/lib';
import {
  createCommentAsync,
  listCommentsAsync,
  deleteCommentAsync,
  type CommentTargetType,
} from '@/lib/comments';
import { broadcastNewComment, broadcastDeleteComment } from '@/lib/yjs-broadcast';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TARGETS: CommentTargetType[] = ['project', 'shot', 'scene', 'character', 'storyboard'];

function resolveUserId(request: Request): { id: string; name: string; avatarUrl: string | null } | null {
  const payload = getUserFromRequest(request);
  if (payload?.sub) {
    const user = getUserById(payload.sub);
    if (user) return { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
  }
  // demo / 未登录 — 用 seeded 第一个用户兜底, 便于 dev 跑
  const fallback = db.prepare('SELECT id, name, avatar_url FROM users LIMIT 1').get() as
    | { id: string; name: string; avatar_url: string | null }
    | undefined;
  if (fallback) return { id: fallback.id, name: fallback.name, avatarUrl: fallback.avatar_url };
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!projectId) return NextResponse.json({ error: '缺 projectId' }, { status: 400 });

  const targetType = request.nextUrl.searchParams.get('targetType') as CommentTargetType | null;
  const targetId = request.nextUrl.searchParams.get('targetId') || undefined;
  const limitStr = request.nextUrl.searchParams.get('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  if (targetType && !ALLOWED_TARGETS.includes(targetType)) {
    return NextResponse.json({ error: `invalid targetType: ${targetType}` }, { status: 400 });
  }

  const comments = await listCommentsAsync({
    projectId,
    targetType: targetType || undefined,
    targetId: targetId || undefined,
    limit,
  });
  return NextResponse.json({ comments });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const user = resolveUserId(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: '非法 JSON' }, { status: 400 }); }

  const targetType = String(body?.targetType || '') as CommentTargetType;
  const targetId = String(body?.targetId || '');
  const content = typeof body?.content === 'string' ? body.content : '';
  const parentId = typeof body?.parentId === 'string' ? body.parentId : null;

  if (!ALLOWED_TARGETS.includes(targetType)) {
    return NextResponse.json({ error: `invalid targetType` }, { status: 400 });
  }
  if (!targetId) return NextResponse.json({ error: '缺 targetId' }, { status: 400 });

  // v3.x E.1: 校验附件 (createComment 会再校一次, 这里给客户端友好错误)
  const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
  const attachments = rawAttachments
    .filter((a: any) => a && typeof a.url === 'string' && a.url.startsWith('http'))
    .filter((a: any) => ['image', 'video', 'file'].includes(a.type))
    .slice(0, 6);

  if (!content.trim() && attachments.length === 0) {
    return NextResponse.json({ error: '评论或附件至少有一个' }, { status: 400 });
  }
  if (content.length > 2000) return NextResponse.json({ error: '评论超过 2000 字' }, { status: 400 });

  try {
    const result = await createCommentAsync({
      projectId,
      targetType,
      targetId,
      authorUserId: user.id,
      authorName: user.name,
      authorAvatarUrl: user.avatarUrl,
      content,
      parentId,
      attachments,
    });
    // v3.0 P0.2: 写完 DB 后异步广播到 Yjs — 在线客户端实时收到, 不再依赖 30s 轮询.
    // 失败不阻塞响应 (broadcast 是 best-effort, client 还能 fallback 到下次拉).
    void broadcastNewComment(projectId, result.comment);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || '创建评论失败' }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const user = resolveUserId(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const commentId = request.nextUrl.searchParams.get('commentId');
  if (!commentId) return NextResponse.json({ error: '缺 commentId' }, { status: 400 });

  const ok = await deleteCommentAsync(commentId, user.id);
  if (!ok) return NextResponse.json({ error: '不存在或无权删除' }, { status: 403 });
  // v3.0 P0.2: 广播软删, 在线 client 把 row 上的 deletedAt 标位置
  void broadcastDeleteComment(projectId, commentId, new Date().toISOString());
  return NextResponse.json({ deleted: true });
}
