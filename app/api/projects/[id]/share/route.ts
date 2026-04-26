import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
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
 * token 直接写 `projects.share_token` 字段;列存在才启用,否则热备一张独立表。
 * 共享页由 /app/share/[token]/page.tsx 按 read-only 呈现。
 */

function ensureShareSchema() {
  try {
    const row = db.prepare("PRAGMA table_info('projects')").all() as Array<{ name: string }>;
    if (!row.some(r => r.name === 'share_token')) {
      db.exec("ALTER TABLE projects ADD COLUMN share_token TEXT");
    }
    if (!row.some(r => r.name === 'share_created_at')) {
      db.exec("ALTER TABLE projects ADD COLUMN share_created_at TEXT");
    }
  } catch (e) {
    console.warn('[share] ensureShareSchema failed:', e);
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  ensureShareSchema();

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as any;
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const token = nanoid(18);
  db.prepare('UPDATE projects SET share_token = ?, share_created_at = ? WHERE id = ?')
    .run(token, now(), projectId);

  return NextResponse.json({
    token,
    shareUrl: `/share/${token}`,
    createdAt: now(),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  ensureShareSchema();
  db.prepare('UPDATE projects SET share_token = NULL, share_created_at = NULL WHERE id = ?').run(projectId);
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  ensureShareSchema();
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
