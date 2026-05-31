import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { getDbDriver } from '@/lib/db-driver';
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

  // v9.0.1b: project_assets 读写统一走 DbDriver (双驱动, 避免 pg 模式下读 sqlite 的脑裂)
  const rows = await getDbDriver().query<{ id: string; type: string; updated_at: string; stale: number }>(
    'SELECT id, type, updated_at, stale FROM project_assets WHERE project_id = ?', [id],
  );
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

  // 落库: 事务内清 target stale + 置下游 stale + 审计 (project_assets + pipeline_reruns 原子)
  // v9.0.1b: 走 DbDriver.transaction (tx-scoped executor) — 两表跨驱动一致原子; 不混用全局
  // repo 方法 (它们走全局 driver, 在 pg 下不在本事务的 client 里)。
  await getDbDriver().transaction(async (tx) => {
    if (targetTypes.length) {
      const ph = targetTypes.map(() => '?').join(',');
      await tx.run(`UPDATE project_assets SET stale = 0 WHERE project_id = ? AND type IN (${ph})`, [id, ...targetTypes]);
    }
    for (const assetId of plan.affectedAssetIds) {
      await tx.run('UPDATE project_assets SET stale = 1 WHERE id = ? AND project_id = ?', [assetId, id]);
    }
    await tx.run(
      `INSERT INTO pipeline_reruns (id, project_id, stage, invalidates, affected_asset_ids, dispatched, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(), id, stage, JSON.stringify(plan.invalidates), JSON.stringify(plan.affectedAssetIds),
        dispatched ? 1 : 0, dispatched ? '已派发活跃 orchestrator' : '无活跃实例, 仅标记失效', now(),
      ],
    );
  });

  // 回新状态
  const freshRows = await getDbDriver().query<{ type: string; updated_at: string; stale: number }>(
    'SELECT type, updated_at, stale FROM project_assets WHERE project_id = ?', [id],
  );
  const stages = derivePipelineStages(freshRows.map((r) => ({ type: r.type, updatedAt: r.updated_at, stale: !!r.stale })));

  return NextResponse.json({ ok: true, plan, dispatched, stages });
}
