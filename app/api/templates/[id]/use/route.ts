/**
 * POST /api/templates/[id]/use · v9.6.8 — 记一次「用此模板起片」(use_count++),返回最新模板(含 payload)。
 */
import { NextResponse } from 'next/server';
import { recordTemplateUse, getTemplate } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await recordTemplateUse(id);
  if (!ok) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  return NextResponse.json({ ok: true, template: await getTemplate(id) });
}
