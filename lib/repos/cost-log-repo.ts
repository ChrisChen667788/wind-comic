/**
 * v9.7.2 — cost_log 写入仓库(async,双驱动)。
 *
 * v9.3 的成本可观测一直只「读」cost_log,没有生产写入路径 → T3 成本面板实际常空。
 * 本 repo 是**首个生产写入器**:TTS 配音 / 口型渲染各记一笔,T3 `attributeCost` 自动归类显示。
 * engine 串带类目关键词(`tts-*` / `lipsync-*`)以命中 `classifyEngineCategory`。
 * 记账失败绝不阻断主流程(try/catch 吞错)。单测 tests/v9-7-2-cost-log-repo.test.ts。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface CostLogInput {
  /** 必填:FK users(无则跳过,不违反约束)。 */
  userId: string | null | undefined;
  projectId?: string | null;
  /** 供 classifyEngineCategory 归类(应含 tts/lip/video/image/llm 关键词)。 */
  engine: string;
  resolution?: string;
  durationSec?: number;
  costCny: number;
  metadata?: Record<string, unknown>;
}

/** 记一笔成本。userId 缺失 / 负成本 / 异常 → 返回 false 且不抛(成本记账不阻断主流程)。 */
export async function recordCostLog(input: CostLogInput): Promise<boolean> {
  if (!input.userId) return false;
  const cost = round2(input.costCny);
  if (!(cost >= 0)) return false;
  try {
    await getDbDriver().run(
      `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'cl_' + nanoid(12), input.userId, input.projectId ?? null,
        (input.engine || 'unknown').slice(0, 80), input.resolution ?? '',
        Number(input.durationSec) || 0, cost,
        JSON.stringify(input.metadata ?? {}), new Date().toISOString(),
      ],
    );
    return true;
  } catch {
    return false;
  }
}

/** TTS 成本估算(¥):有时长按 ~¥0.02/s,否则兜底按字 ~¥0.004/字。 */
export function estimateTtsCostCny(durationSec?: number, textLen?: number): number {
  const sec = Number(durationSec) || 0;
  if (sec > 0) return round2(sec * 0.02);
  return round2((Number(textLen) || 0) * 0.004);
}

/** 口型渲染成本估算(¥):引擎给了用引擎值,否则 ~¥0.15/s、最低 ¥0.1。 */
export function estimateLipsyncCostCny(provided?: number, durationSec?: number): number {
  if (typeof provided === 'number' && provided > 0) return round2(provided);
  const sec = Number(durationSec) || 0;
  return round2(Math.max(0.1, sec * 0.15));
}
