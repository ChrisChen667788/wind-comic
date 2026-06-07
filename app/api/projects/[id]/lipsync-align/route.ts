/**
 * /api/projects/[id]/lipsync-align · v9.7.14
 *
 * 存/读 实测的「口型-音频对齐分」(shotNumber → 0-100,来自面板 Web Audio 测量 / 批量 QC)。
 * 存 `project_assets type='lipsync-align'`(一项目一条,合并式)。publish-readiness 据此并入发布门禁。
 */
import { NextResponse } from 'next/server';
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readScores(id: string): Promise<Record<string, number>> {
  const rows = await listAssetsByType(id, 'lipsync-align');
  try { return JSON.parse(rows[0]?.data || '{}')?.scores || {}; } catch { return {}; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ scores: await readScores(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { scores?: Record<string, unknown> };
  const incoming = body?.scores && typeof body.scores === 'object' ? body.scores : {};
  const merged: Record<string, number> = { ...(await readScores(id)) };
  for (const [k, v] of Object.entries(incoming)) {
    const n = Number(v);
    if (String(k).trim() && Number.isFinite(n)) merged[String(k)] = Math.round(Math.max(0, Math.min(100, n)));
  }
  await deleteAssetsByType(id, 'lipsync-align');
  await createAsset({ projectId: id, type: 'lipsync-align', name: '口型-音频对齐分', data: { scores: merged }, version: 1 });
  return NextResponse.json({ ok: true, scores: merged });
}
