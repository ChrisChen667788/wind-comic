import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { listCharactersByUser, createCharacter } from '@/lib/repos/character-repo'; // v9.0.3c: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // If no auth, fall back to the first user in the DB (single-user / demo mode)
  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const rows = await listCharactersByUser(userId);

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
    const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const body = await request.json().catch(() => ({}));
  const { name, description, appearance, visualTags, imageUrls, styleKeywords } = body;

  if (!name) {
    return NextResponse.json({ message: 'Missing name' }, { status: 400 });
  }

  // v9.0.3c: 走 character-repo (双驱动); 返回落库后的真实行
  const row = await createCharacter({ userId, name, description, appearance, visualTags, imageUrls, styleKeywords });

  return NextResponse.json(
    {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      appearance: row.appearance,
      visualTags: JSON.parse(row.visual_tags || '[]'),
      imageUrls: JSON.parse(row.image_urls || '[]'),
      styleKeywords: row.style_keywords,
      usageCount: row.usage_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    { status: 201 }
  );
}
