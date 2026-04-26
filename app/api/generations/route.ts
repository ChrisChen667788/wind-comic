import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';

function mockSvg(label: string, c1: string, c2: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="600" height="400" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-family="system-ui" font-size="28">${label}</text></svg>`)}`;
}

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const rows = db.prepare('SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC').all(payload.sub) as any[];
  const data = rows.map((r) => ({
    id: r.id, projectId: r.project_id, prompt: r.prompt,
    style: r.style, status: r.status,
    resultUrls: JSON.parse(r.result_urls || '[]'), createdAt: r.created_at,
  }));
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { prompt, style, projectId } = body;
  if (!prompt || !style) return NextResponse.json({ message: 'Missing prompt or style' }, { status: 400 });

  const id = nanoid();
  const ts = now();
  const mockResults = [
    mockSvg('Generated 1', '#4c1d95', '#ec4899'),
    mockSvg('Generated 2', '#0e7490', '#4de0c2'),
  ];

  db.prepare(`INSERT INTO generations (id, user_id, project_id, prompt, style, status, result_urls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, payload.sub, projectId || null, prompt, style, 'completed', JSON.stringify(mockResults), ts
  );

  return NextResponse.json({ id, projectId: projectId || null, prompt, style, status: 'completed', resultUrls: mockResults, createdAt: ts }, { status: 201 });
}
