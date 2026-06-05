/**
 * /api/projects/[id]/lipsync · v9.6.2 (阶段十六 T1 配音口型)
 *
 * GET 项目级口型规划 —— 从剧本分镜抽对白 → viseme 关键帧轨 + 可对齐度评分 + 整片就绪度
 * (`lib/lipsync-plan`)。只读,供「配音口型」视图驱动嘴部动画预览 + 提示哪些对白镜口型对不上
 * (画外音 / 景别过远 / 台词溢出)。非破坏性,不改任何生成行为。
 *
 * Auth: 与其它项目级只读报告端点(consistency / publish-readiness)一致,只读不强制登录。
 */
import { NextResponse } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { dialogueLinesFromShots, buildLipSyncPlan } from '@/lib/lipsync-plan';
import type { ScriptShot } from '@/types/agents';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const scriptRows = await listAssetsByType(id, 'script');
  let script: { shots?: ScriptShot[] } = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shots: ScriptShot[] = Array.isArray(script.shots) ? script.shots : [];

  const lines = dialogueLinesFromShots(shots);
  const plan = buildLipSyncPlan(lines);

  return NextResponse.json({ projectId: id, plan, totalShots: shots.length });
}
