import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';

export const runtime = 'nodejs';

function getCharacter(id: string) {
  return db.prepare('SELECT * FROM character_library WHERE id = ?').get(id) as any | undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
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
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const row = getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    name,
    description,
    appearance,
    visualTags,
    imageUrls,
    styleKeywords,
    usageCount,
  } = body;

  const ts = now();

  db.prepare(
    `UPDATE character_library SET
      name = ?,
      description = ?,
      appearance = ?,
      visual_tags = ?,
      image_urls = ?,
      style_keywords = ?,
      usage_count = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    name ?? row.name,
    description ?? row.description,
    appearance ?? row.appearance,
    JSON.stringify(visualTags ?? JSON.parse(row.visual_tags || '[]')),
    JSON.stringify(imageUrls ?? JSON.parse(row.image_urls || '[]')),
    styleKeywords ?? row.style_keywords,
    usageCount ?? row.usage_count,
    ts,
    id
  );

  const updated = getCharacter(id);
  return NextResponse.json({
    id: updated.id,
    userId: updated.user_id,
    name: updated.name,
    description: updated.description,
    appearance: updated.appearance,
    visualTags: JSON.parse(updated.visual_tags || '[]'),
    imageUrls: JSON.parse(updated.image_urls || '[]'),
    styleKeywords: updated.style_keywords,
    usageCount: updated.usage_count,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const row = getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  db.prepare('DELETE FROM character_library WHERE id = ?').run(id);

  return NextResponse.json({ message: 'Deleted' });
}
