import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // If no auth, fall back to the first user in the DB (single-user / demo mode)
  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  // 一次查询: 项目本表 + 最新 script asset 的 data (子查询).
  // 这样列表页就能拿到 latestPolish 渲染就绪度徽章, 而不必每张卡再发一次请求。
  const rows = db.prepare(`
    SELECT p.*, (
      SELECT data FROM project_assets
      WHERE project_id = p.id AND type = 'script'
      ORDER BY updated_at DESC LIMIT 1
    ) AS script_asset_data
    FROM projects p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId) as any[];
  const data = rows.map((r) => {
    let latestPolish: any = null;
    if (r.script_asset_data) {
      try {
        const parsed = JSON.parse(r.script_asset_data);
        if (parsed && typeof parsed === 'object' && parsed.latestPolish) {
          latestPolish = parsed.latestPolish;
        }
      } catch { /* 该 asset 数据格式异常, 安静跳过 */ }
    }
    return {
      id: r.id, title: r.title, description: r.description,
      covers: JSON.parse(r.cover_urls || '[]'), status: r.status,
      scriptData: r.script_data ? JSON.parse(r.script_data) : null,
      directorNotes: r.director_notes ? JSON.parse(r.director_notes) : null,
      latestPolish, // null 或 { mode, audit, summary, at, ... } —— 列表页就能渲染就绪度徽章
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { title, description, covers } = body;
  if (!title) return NextResponse.json({ message: 'Missing title' }, { status: 400 });

  const id = nanoid();
  const ts = now();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, payload.sub, title, description || '', JSON.stringify(covers || []), 'draft', ts, ts
  );

  return NextResponse.json({ id, title, description: description || '', covers: covers || [], status: 'draft', createdAt: ts, updatedAt: ts }, { status: 201 });
}
