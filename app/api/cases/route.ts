import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// v9.5.4: 每次实时读库, 别被 Next 静态缓存(否则加了 video_url 也发不出去 → 案例视频「没生效」)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all() as any[];
  const data = rows.map((r) => ({
    id: r.id, title: r.title, category: r.category,
    coverUrl: r.cover_url, authorName: r.author_name,
    authorAvatar: r.author_avatar, videoUrl: r.video_url || null,
    metrics: JSON.parse(r.metrics || '{}'), createdAt: r.created_at,
  }));
  return NextResponse.json(data);
}
