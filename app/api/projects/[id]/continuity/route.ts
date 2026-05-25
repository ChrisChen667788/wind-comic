/**
 * /api/projects/[id]/continuity · v7.3 — 项目级连贯性设置 (种子锁 / 链接模式 / 强度 / 锁开关 / FaceID)
 *
 * GET  → { settings }                 读当前设置 (无则默认)
 * POST { settings } → { ok, settings } 保存 (upsert 到 project_assets type='continuity' 单行)
 *
 * 不重生成任何资产 — 仅持久化设置, 供后续逐镜生成/重生成时消费 (compileContinuityDirectives)。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, createAsset, updateAsset } from '@/lib/repos/asset-repo';
import { normalizeContinuitySettings, defaultContinuitySettings } from '@/lib/continuity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASSET_NAME = 'continuity-settings';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const rows = await listAssetsByType(projectId, 'continuity');
  if (!rows.length) return NextResponse.json({ settings: defaultContinuitySettings() });
  let data: any = {};
  try { data = JSON.parse(rows[0].data || '{}'); } catch { data = {}; }
  return NextResponse.json({ settings: normalizeContinuitySettings(data) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const settings = normalizeContinuitySettings(body?.settings ?? body);

  const rows = await listAssetsByType(projectId, 'continuity');
  if (rows.length) {
    const ok = await updateAsset(rows[0].id, { data: settings });
    if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });
  } else {
    await createAsset({ projectId, type: 'continuity', name: ASSET_NAME, data: settings });
  }
  return NextResponse.json({ ok: true, settings });
}
