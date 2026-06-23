/**
 * 阶段三十 v12.37.0 — 可审计 AI 决策日志(纯聚合,可单测)。
 *
 * 把已落库的「成本(cost_log)+ 分镜资产 + 质量分」聚合成**逐镜可复查记录**:每镜用了哪个引擎、
 * 花多少钱、prompt 是什么、是否九宫格选定、一致性分多少。给甲方/导演一份「为什么这么出片」的审计账。
 *
 * 诚实边界:这是**结果级**审计(用了什么 + 花了多少 + 评分),不是完整「为什么选这个引擎」的推理链
 *(后者目前只在运行时事件里、未落库;持久化推理链是后续增强)。
 */

import type { CostLogRow } from './repos/cost-log-repo';

export interface ShotDecision {
  shotNumber: number;
  videoEngine?: string;          // 主出片引擎(从 video-* 成本行提取)
  costCny: number;               // 该镜总成本(相关成本行求和)
  engines: string[];             // 该镜涉及的所有引擎(去重)
  prompt?: string;               // 分镜 prompt(storyboard 资产)
  consistencyScore?: number;     // 一致性分(资产里有才填)
  pickedFromCandidate?: string;  // 来自九宫格选定的候选 id
}

export interface DecisionLog {
  shots: ShotDecision[];
  totals: { totalCostCny: number; shotCount: number; byEngine: Array<{ engine: string; costCny: number; count: number }> };
  nonShotCosts: Array<{ engine: string; costCny: number }>; // 无镜号成本(项目级:封面/整片配乐等)
  quality?: { overall?: number; continuity?: number; lighting?: number; face?: number } | null;
}

interface AssetLite { type: string; shot_number?: number | null; shotNumber?: number | null; data?: unknown }

function parseData(d: unknown): Record<string, unknown> {
  if (!d) return {};
  if (typeof d === 'object') return d as Record<string, unknown>;
  if (typeof d === 'string') { try { return JSON.parse(d); } catch { return {}; } }
  return {};
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const numOr = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

export function buildDecisionLog(input: {
  costRows: CostLogRow[];
  assets?: AssetLite[];
  quality?: Record<string, unknown> | null;
}): DecisionLog {
  const shotMap = new Map<number, ShotDecision>();
  const nonShot: Array<{ engine: string; costCny: number }> = [];
  const byEngine = new Map<string, { costCny: number; count: number }>();

  for (const row of input.costRows || []) {
    const eng = row.engine || 'unknown';
    const be = byEngine.get(eng) || { costCny: 0, count: 0 };
    be.costCny = r2(be.costCny + row.costCny); be.count++; byEngine.set(eng, be);

    const sn = numOr((row.metadata as Record<string, unknown> | undefined)?.shotNumber);
    if (!sn || sn <= 0) { nonShot.push({ engine: eng, costCny: row.costCny }); continue; }
    const s = shotMap.get(sn) || { shotNumber: sn, costCny: 0, engines: [] };
    s.costCny = r2(s.costCny + row.costCny);
    if (!s.engines.includes(eng)) s.engines.push(eng);
    if (eng.startsWith('video-') && !s.videoEngine) s.videoEngine = eng.replace(/^video-/, '');
    shotMap.set(sn, s);
  }

  for (const a of input.assets || []) {
    if (a.type !== 'storyboard') continue;
    const sn = numOr(a.shot_number ?? a.shotNumber);
    if (!sn || sn <= 0) continue;
    const s = shotMap.get(sn) || { shotNumber: sn, costCny: 0, engines: [] };
    const d = parseData(a.data);
    if (typeof d.prompt === 'string' && !s.prompt) s.prompt = (d.prompt as string).slice(0, 400);
    const cs = numOr(d.consistency ?? d.consistencyScore);
    if (cs != null && s.consistencyScore == null) s.consistencyScore = cs;
    if (typeof d.fromCandidate === 'string') s.pickedFromCandidate = d.fromCandidate as string;
    shotMap.set(sn, s);
  }

  const shots = [...shotMap.values()].sort((a, b) => a.shotNumber - b.shotNumber);
  const totalCostCny = r2(
    [...shotMap.values()].reduce((t, s) => t + s.costCny, 0) + nonShot.reduce((t, x) => t + x.costCny, 0),
  );
  const byEngineArr = [...byEngine.entries()]
    .map(([engine, v]) => ({ engine, costCny: v.costCny, count: v.count }))
    .sort((a, b) => b.costCny - a.costCny);

  const q = input.quality;
  const quality = q
    ? { overall: numOr(q.overall_score ?? q.overall), continuity: numOr(q.continuity_score ?? q.continuity), lighting: numOr(q.lighting_score ?? q.lighting), face: numOr(q.face_score ?? q.face) }
    : null;

  return { shots, totals: { totalCostCny, shotCount: shots.length, byEngine: byEngineArr }, nonShotCosts: nonShot, quality };
}
