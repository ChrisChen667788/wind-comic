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

/** v12.37.0(决策日志):按项目读 cost_log(只读,双驱动)。 */
export interface CostLogRow {
  id: string; engine: string; resolution: string;
  durationSec: number; costCny: number;
  metadata: Record<string, unknown>; createdAt: string;
}
export async function listCostLogByProject(projectId: string): Promise<CostLogRow[]> {
  if (!projectId) return [];
  try {
    const rows = await getDbDriver().query(
      `SELECT id, engine, resolution, duration_sec, cost_cny, metadata, created_at
       FROM cost_log WHERE project_id = ? ORDER BY created_at ASC`,
      [projectId],
    ) as Array<Record<string, unknown>>;
    return (rows || []).map((r) => ({
      id: String(r.id || ''),
      engine: String(r.engine || ''),
      resolution: String(r.resolution || ''),
      durationSec: Number(r.duration_sec) || 0,
      costCny: Number(r.cost_cny) || 0,
      metadata: (() => { try { return typeof r.metadata === 'string' ? JSON.parse(r.metadata as string) : ((r.metadata as Record<string, unknown>) || {}); } catch { return {}; } })(),
      createdAt: String(r.created_at || ''),
    }));
  } catch { return []; }
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

// v12.4.0(阶段二十三):主管线视频/图像成本此前从不落库 → cost-attribution 两大类目永远 0、
// 预算护栏对主创作链零拦截。下面两个估算器堵这个洞;费率保守(宁高勿低,上线前对账单校准)。

/** 视频引擎 → ¥/s 保守费率(Veo 0.6 / Kling Master 0.2 / Minimax 0.1 / Vidu 0.3),未知 0.3 兜底。 */
const VIDEO_RATE_CNY_PER_SEC: Record<string, number> = { veo: 0.6, kling: 0.2, minimax: 0.1, vidu: 0.3 };
export function videoRateForProvider(providerId?: string): number {
  if (!providerId) return 0.3;
  const id = providerId.toLowerCase();
  for (const k of Object.keys(VIDEO_RATE_CNY_PER_SEC)) if (id.includes(k)) return VIDEO_RATE_CNY_PER_SEC[k];
  return 0.3;
}

/** 视频成本估算(¥):durationSec × ¥/s 费率(缺时长按 5s、缺费率按 ¥0.3/s 保守兜底)。 */
export function estimateVideoCostCny(durationSec?: number, ratePerSec?: number): number {
  const sec = Number(durationSec) || 5;
  const rate = typeof ratePerSec === 'number' && ratePerSec > 0 ? ratePerSec : 0.3;
  return round2(sec * rate);
}

/** 图像成本估算(¥):引擎给了用引擎值,否则保守每张 ¥0.3。 */
export function estimateImageCostCny(provided?: number): number {
  if (typeof provided === 'number' && provided > 0) return round2(provided);
  return 0.3;
}
