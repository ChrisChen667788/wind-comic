/**
 * /api/projects/[id]/voice-overrides · v9.7.7 (阶段十六 · 音色手动覆盖)
 *
 * 角色 → 音色的用户手动覆盖(覆盖自动路由)。存 `project_assets type='voice-overrides'`(一项目一条)。
 * GET → { overrides }; POST { overrides } → 覆盖式落库。shot-audio 取此 > 自动路由。
 */
import { NextResponse } from 'next/server';
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await listAssetsByType(id, 'voice-overrides');
  let overrides: Record<string, string> = {};
  try { overrides = JSON.parse(rows[0]?.data || '{}')?.overrides || {}; } catch { overrides = {}; }
  return NextResponse.json({ overrides });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { overrides?: Record<string, unknown> };
  const raw = body?.overrides && typeof body.overrides === 'object' ? body.overrides : {};
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim();
    if (key && typeof v === 'string' && v.trim()) overrides[key] = v.trim();
  }
  await deleteAssetsByType(id, 'voice-overrides');
  await createAsset({ projectId: id, type: 'voice-overrides', name: '角色音色覆盖', data: { overrides }, version: 1 });
  return NextResponse.json({ ok: true, overrides });
}
