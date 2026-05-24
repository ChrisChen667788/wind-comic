import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import {
  PIPELINE_STAGES, buildRerunPlan, derivePipelineStages,
  type StageAsset, type StageId,
} from '@/lib/pipeline-stages';

export const runtime = 'nodejs';

const VALID_STAGES = new Set<StageId>(PIPELINE_STAGES.map((s) => s.id));

/** 环节 → 既有管线里负责该环节的 agent role (派发到活跃 orchestrator 用). */
const STAGE_ROLE: Record<StageId, string> = {
  script: 'writer',
  assets: 'character_designer',
  storyboard: 'storyboard',
  final: 'video_producer',
};

/**
 * v6.4.1 — 单环节真重跑端点.
 * POST { stage } →
 *   1. 算重跑计划 (target + 失效下游 + 受影响资产)
 *   2. 落库: 清 target 环节资产 stale, 置下游受影响资产 stale=1, 记审计
 *   3. 尽力派发到活跃 orchestrator 走既有管线重生 (无活跃实例则 dispatched=false, 仅标记)
 *   4. 回新流水线状态 (下游已 stale)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({} as any));
  const stage = body?.stage as StageId;

  if (!stage || !VALID_STAGES.has(stage)) {
    return NextResponse.json({ message: `stage 必须是 ${[...VALID_STAGES].join('/')}` }, { status: 400 });
  }
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as { id: string } | undefined;
  if (!project) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const rows = db.prepare('SELECT id, type, updated_at, stale FROM project_assets WHERE project_id = ?').all(id) as
    Array<{ id: string; type: string; updated_at: string; stale: number }>;
  const assets: StageAsset[] = rows.map((r) => ({ id: r.id, type: r.type, updatedAt: r.updated_at, stale: !!r.stale }));

  const plan = buildRerunPlan(assets, stage);
  const targetTypes = PIPELINE_STAGES.find((s) => s.id === stage)!.assetTypes;

  // 尝试派发到活跃 orchestrator (与既有 regenerate 路由同款防御式探测)
  let dispatched = false;
  try {
    const mod = await import('@/services/hybrid-orchestrator');
    const reg = (mod as Record<string, unknown>)['activeOrchestrators'] as
      | Map<string, { regenerateStage?: (role: string, fb: string) => void }>
      | undefined;
    const inst = reg?.get(id);
    if (inst && typeof inst.regenerateStage === 'function') {
      inst.regenerateStage(STAGE_ROLE[stage], `重跑「${stage}」环节 (导演台触发)`);
      dispatched = true;
    }
  } catch { /* 无活跃实例 → 仅标记失效, 用户进入环节 tab 时走既有重生 */ }

  // 落库: 事务内清 target stale + 置下游 stale + 审计
  const apply = db.transaction(() => {
    if (targetTypes.length) {
      const ph = targetTypes.map(() => '?').join(',');
      db.prepare(`UPDATE project_assets SET stale = 0 WHERE project_id = ? AND type IN (${ph})`).run(id, ...targetTypes);
    }
    for (const assetId of plan.affectedAssetIds) {
      db.prepare('UPDATE project_assets SET stale = 1 WHERE id = ? AND project_id = ?').run(assetId, id);
    }
    db.prepare(
      `INSERT INTO pipeline_reruns (id, project_id, stage, invalidates, affected_asset_ids, dispatched, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nanoid(), id, stage, JSON.stringify(plan.invalidates), JSON.stringify(plan.affectedAssetIds),
      dispatched ? 1 : 0, dispatched ? '已派发活跃 orchestrator' : '无活跃实例, 仅标记失效', now(),
    );
  });
  apply();

  // 回新状态
  const freshRows = db.prepare('SELECT type, updated_at, stale FROM project_assets WHERE project_id = ?').all(id) as
    Array<{ type: string; updated_at: string; stale: number }>;
  const stages = derivePipelineStages(freshRows.map((r) => ({ type: r.type, updatedAt: r.updated_at, stale: !!r.stale })));

  return NextResponse.json({ ok: true, plan, dispatched, stages });
}
