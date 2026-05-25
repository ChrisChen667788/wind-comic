/**
 * /api/projects/[id]/format · v7.4 — 项目级格式 (画幅 / 色彩空间 / 帧率 / 安全框)
 *
 * GET  → { format }                  读当前 (无则默认 Scope/ACES/24/安全框)
 * POST { format } → { ok, format }   upsert 到 project_assets type='project-format'
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, createAsset, updateAsset } from '@/lib/repos/asset-repo';
import { normalizeProjectFormat, DEFAULT_PROJECT_FORMAT } from '@/lib/project-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const rows = await listAssetsByType(projectId, 'project-format');
  if (!rows.length) return NextResponse.json({ format: DEFAULT_PROJECT_FORMAT });
  let data: any = {};
  try { data = JSON.parse(rows[0].data || '{}'); } catch { data = {}; }
  return NextResponse.json({ format: normalizeProjectFormat(data) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const format = normalizeProjectFormat(body?.format ?? body);

  const rows = await listAssetsByType(projectId, 'project-format');
  if (rows.length) {
    const ok = await updateAsset(rows[0].id, { data: format });
    if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });
  } else {
    await createAsset({ projectId, type: 'project-format', name: 'project-format', data: format });
  }
  return NextResponse.json({ ok: true, format });
}
