/**
 * /api/projects/[id]/format · v7.4 — 项目级格式 (色彩空间 / 帧率 / 安全框)
 *
 * GET  → { format }                  读当前 (无则默认 ACES/24/安全框)
 * POST { format } → { ok, format }   upsert 到 project_assets type='project-format'
 *
 * v12.464:画幅不归这里 —— 只有 `projects.aspect` 一处(详情接口吐 `aspect`)。旧资产里的 `aspectId`
 * 读时由 normalizeProjectFormat 丢弃,请求体带了也不落库。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, createAsset, updateAsset } from '@/lib/repos/asset-repo';
import { normalizeProjectFormat, DEFAULT_PROJECT_FORMAT } from '@/lib/project-format';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const rows = await listAssetsByType(projectId, 'project-format');
  if (!rows.length) return NextResponse.json({ format: DEFAULT_PROJECT_FORMAT });
  let data: any = {};
  try { data = JSON.parse(rows[0].data || '{}'); } catch { data = {}; }
  return NextResponse.json({ format: normalizeProjectFormat(data) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

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
