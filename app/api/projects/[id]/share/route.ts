import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { updateProjectById } from '@/lib/repos/project-repo';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 轻量版项目共享链接
 *
 *  POST /api/projects/:id/share   → 生成/刷新共享 token,返回 shareUrl
 *  DELETE /api/projects/:id/share → 撤销共享
 *  GET  /api/projects/:id/share   → 查看当前共享状态
 *
 * token 直接写 `projects.share_token` 字段。
 * v9.0.2b: share_token/share_created_at 已纳入 canonical schema (lib/db.ts addColumnIfMissing),
 *   不再需要运行时 ensureShareSchema 热加 (那是 SQLite PRAGMA/ALTER, PG 不兼容); 写走 project-repo 双驱动。
 * 共享页由 /app/share/[token]/page.tsx 按 read-only 呈现。
 */

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as any;
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const token = nanoid(18);
  const createdAt = now();
  await updateProjectById(projectId, { share_token: token, share_created_at: createdAt });

  return NextResponse.json({
    token,
    shareUrl: `/share/${token}`,
    createdAt,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  await updateProjectById(projectId, { share_token: null, share_created_at: null });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const row = db.prepare('SELECT share_token, share_created_at FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  if (!row.share_token) return NextResponse.json({ enabled: false });
  return NextResponse.json({
    enabled: true,
    token: row.share_token,
    shareUrl: `/share/${row.share_token}`,
    createdAt: row.share_created_at,
  });
}
