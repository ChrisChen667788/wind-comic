import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // If no auth, fall back to the first user in the DB (single-user / demo mode)
  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const rows = db.prepare(
    'SELECT * FROM character_library WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as any[];

  const data = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    appearance: r.appearance,
    visualTags: JSON.parse(r.visual_tags || '[]'),
    imageUrls: JSON.parse(r.image_urls || '[]'),
    styleKeywords: r.style_keywords,
    usageCount: r.usage_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // Fall back to first DB user in demo mode
  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const body = await request.json().catch(() => ({}));
  const { name, description, appearance, visualTags, imageUrls, styleKeywords } = body;

  if (!name) {
    return NextResponse.json({ message: 'Missing name' }, { status: 400 });
  }

  const id = nanoid();
  const ts = now();

  db.prepare(
    `INSERT INTO character_library (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    name,
    description || '',
    appearance || '',
    JSON.stringify(visualTags || []),
    JSON.stringify(imageUrls || []),
    styleKeywords || '',
    0,
    ts,
    ts
  );

  return NextResponse.json(
    {
      id,
      userId,
      name,
      description: description || '',
      appearance: appearance || '',
      visualTags: visualTags || [],
      imageUrls: imageUrls || [],
      styleKeywords: styleKeywords || '',
      usageCount: 0,
      createdAt: ts,
      updatedAt: ts,
    },
    { status: 201 }
  );
}
