import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { getCharacter, updateCharacter, deleteCharacter } from '@/lib/repos/character-repo'; // v9.0.3c: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getCharacter(id);
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
    const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const row = await getCharacter(id);
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

  // v9.0.3c: 走 character-repo (双驱动); 每字段用现值兜底 (与原逻辑一致)
  const updated = await updateCharacter(id, {
    name: name ?? row.name,
    description: description ?? row.description,
    appearance: appearance ?? row.appearance,
    visualTags: visualTags ?? JSON.parse(row.visual_tags || '[]'),
    imageUrls: imageUrls ?? JSON.parse(row.image_urls || '[]'),
    styleKeywords: styleKeywords ?? row.style_keywords,
    usageCount: usageCount ?? row.usage_count,
  });
  if (!updated) return NextResponse.json({ message: 'Not found' }, { status: 404 });
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
    const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const row = await getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  await deleteCharacter(id);

  return NextResponse.json({ message: 'Deleted' });
}
