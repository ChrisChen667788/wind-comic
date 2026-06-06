/**
 * GET /api/templates/[id] · v9.6.8 — 取单个模板(详情 / 一键起片预填读 payload)。
 */
import { NextResponse } from 'next/server';
import { getTemplate } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  return NextResponse.json({ template });
}
