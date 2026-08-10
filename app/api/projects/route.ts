import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { createProject } from '@/lib/repos/project-repo';
import { safeJsonParse } from '@/lib/safe-json';

export async function GET(request: Request) {
  // v12.218(安全止血):删「回落 DB 第一个用户」—— 匿名即得他人项目列表。无 token → 401。
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

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
      // v12.305:**列表口不能因为一行坏数据整页 500** —— 一个项目的字段损坏
      // (管道写一半被中断、直接改过 DB、旧格式)此前会让该用户的所有项目一起打不开。
      covers: safeJsonParse<string[]>(r.cover_urls, [], { context: `projects.cover_urls#${r.id}` }), status: r.status,
      scriptData: safeJsonParse<any>(r.script_data, null, { context: `projects.script_data#${r.id}` }),
      directorNotes: safeJsonParse<any>(r.director_notes, null, { context: `projects.director_notes#${r.id}` }),
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

  // v4.2.2: 走 async project-repo (DbDriver), SQLite/PG 双驱动. 行为不变.
  const p = await createProject({ userId: payload.sub, title, description: description || '', coverUrls: covers || [] });

  return NextResponse.json({
    id: p.id, title: p.title, description: p.description || '',
    covers: safeJsonParse<string[]>(p.cover_urls, [], { context: `projects.cover_urls#${p.id}` }), status: p.status,
    createdAt: p.created_at, updatedAt: p.updated_at,
  }, { status: 201 });
}
