import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const rows = db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all() as any[];
  const data = rows.map((r) => ({
    id: r.id, title: r.title, category: r.category,
    coverUrl: r.cover_url, authorName: r.author_name,
    authorAvatar: r.author_avatar,
    metrics: JSON.parse(r.metrics || '{}'), createdAt: r.created_at,
  }));
  return NextResponse.json(data);
}
