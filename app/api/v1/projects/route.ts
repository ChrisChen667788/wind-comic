import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiKey } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 公开 REST API v1 — 项目列表
 *
 *   GET /api/v1/projects
 *     Header: Authorization: Bearer <API_KEY>
 *     Query:  ?limit=20&offset=0&status=active|completed
 *
 * 鉴权:`X-Api-Key` header 或 `Authorization: Bearer` 匹配环境变量 `API_KEYS` (逗号分隔)。
 * 本端点是插件/第三方集成的入口占位,后续会扩展 POST (创建) / GET /:id (详情)。
 */
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const url = req.nextUrl;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20'), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);
  const status = url.searchParams.get('status');

  try {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (status) { conds.push('status = ?'); params.push(status); }
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const rows = db.prepare(
      `SELECT id, title, description, status, cover_urls, created_at, updated_at
       FROM projects ${whereSql}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM projects ${whereSql}`).get(...params) as any)?.n ?? 0;

    return NextResponse.json({
      data: rows.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        coverUrls: safeJson<string[]>(r.cover_urls, []),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      pagination: { limit, offset, total },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'internal_error', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
