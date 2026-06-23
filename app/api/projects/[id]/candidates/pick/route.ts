/**
 * POST /api/projects/[id]/candidates/pick · 阶段二十九 v12.34.0(九宫格 2/3)
 *
 * 用户从九宫格里选中一格 → 该候选帧「上位」为这镜的 storyboard 资产(后续视频生成的首帧 seed)。
 * 服务端权威:从落库的候选集取图(不信客户端传的 URL),校验 pickedId 合法。
 *
 * body: { shotNumber:number, pickedId:string }
 * 200 → { ok:true, shotNumber, pickedId, imageUrl }
 * 400 非法 id / 404 无候选集 / 401 未登录 / 403 非属主
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { getUserFromRequest } from '../../../../auth/lib';
import { validatePick } from '@/lib/candidate-grid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StoredCandidate { id: string; index?: number; variantLabel?: string; prompt?: string; imageUrl: string }

function parseData(raw: unknown): { candidates?: StoredCandidate[] } {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as { candidates?: StoredCandidate[] };
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return {};
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { shotNumber?: number; pickedId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { shotNumber, pickedId } = body;
  if (!shotNumber || typeof shotNumber !== 'number') return NextResponse.json({ error: 'shotNumber required' }, { status: 400 });
  if (!pickedId || typeof pickedId !== 'string') return NextResponse.json({ error: 'pickedId required' }, { status: 400 });

  // 属主守卫
  try {
    const proj = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(projectId) as { user_id?: string } | undefined;
    if (proj?.user_id && proj.user_id !== payload.sub) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } catch { /* demo / 无 user_id → 放行 */ }

  // 取该镜最新候选集(服务端权威)
  let sets: any[] = [];
  try { sets = await listAssetsByType(projectId, 'candidate_set'); } catch { sets = []; }
  const forShot = sets
    .filter((a) => (a.shot_number ?? a.shotNumber) === shotNumber)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  if (forShot.length === 0) return NextResponse.json({ error: '该镜还没有候选集,请先生成九宫格' }, { status: 404 });

  const candidates = parseData(forShot[0].data).candidates || [];
  try { validatePick(candidates, pickedId); } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '无效候选' }, { status: 400 });
  }
  const picked = candidates.find((c) => c.id === pickedId)!;
  if (!picked.imageUrl) return NextResponse.json({ error: '选中候选缺图' }, { status: 400 });

  // 选中帧上位为该镜 storyboard(后续视频生成首帧)
  try {
    await createAsset({
      id: `sb-${projectId}-${shotNumber}-pick-${Date.now()}`,
      projectId, type: 'storyboard', name: `Shot ${shotNumber}(九宫格选定 ${pickedId})`,
      mediaUrls: [picked.imageUrl],
      data: { prompt: picked.prompt || '', fromCandidate: pickedId, variantLabel: picked.variantLabel, picked: true, pickedAt: new Date().toISOString() },
      shotNumber,
    });
  } catch (e) {
    return NextResponse.json({ error: '选定落库失败: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, shotNumber, pickedId, imageUrl: picked.imageUrl });
}
