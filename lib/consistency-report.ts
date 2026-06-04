/**
 * lib/consistency-report (v9.4.5) — 项目级一致性报告(阶段十五收官)。
 *
 * 把跨迭代轮次的成片 3 维一致性评分(连贯 / 光影 / 脸,来自 `quality-scores`)聚合成
 * 「项目级一致性视图 + 趋势」:最新各维 + 跨轮升降方向 + 最弱维 + 时间序列(给折线图)。
 *
 * 纯逻辑、解耦(本地最小输入形)、client 可直引。
 * 输入约定 = `listQualityScores` 的输出顺序(**newest-first**,index 0 = 最新一轮)。
 * 单测 tests/v9-4-5-consistency-report.test.ts。
 */

export interface ConsistencyScoreLike {
  overall: number;
  continuity: number;
  lighting: number;
  face: number;
}

export type ConsistencyDimKey = 'continuity' | 'lighting' | 'face';

export const CONSISTENCY_DIM_LABEL: Record<ConsistencyDimKey, string> = {
  continuity: '连贯',
  lighting: '光影',
  face: '脸一致',
};

export type TrendDirection = 'up' | 'down' | 'flat';

export interface DimensionTrend {
  dimension: ConsistencyDimKey;
  label: string;
  latest: number;
  /** 最旧一轮的值 */
  first: number;
  /** latest - first */
  delta: number;
  direction: TrendDirection;
}

export interface ConsistencyReport {
  rounds: number;
  latest: ConsistencyScoreLike | null;
  /** 3 维趋势(连贯 / 光影 / 脸) */
  trends: DimensionTrend[];
  /** 最新一轮里分最低的一致性维度 */
  weakest: { dimension: ConsistencyDimKey; label: string; score: number } | null;
  /** 时间序列(chronological,旧 → 新),给折线图 */
  series: ConsistencyScoreLike[];
  message: string;
}

function num(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** |delta| ≤ 2 视为持平 */
const FLAT_BAND = 2;

const DIMS: ConsistencyDimKey[] = ['continuity', 'lighting', 'face'];

/**
 * 聚合一致性报告。
 * @param scores newest-first(`listQualityScores` 输出);index 0 = 最新一轮。
 */
export function buildConsistencyReport(scores: ConsistencyScoreLike[]): ConsistencyReport {
  const list = Array.isArray(scores) ? scores : [];
  if (list.length === 0) {
    return {
      rounds: 0, latest: null, trends: [], weakest: null, series: [],
      message: '尚无成片评分 — 跑一次成片打分后即可看一致性趋势',
    };
  }

  const newest = list[0];
  const oldest = list[list.length - 1];
  const chronological = [...list].reverse();

  const trends: DimensionTrend[] = DIMS.map((d) => {
    const latest = num(newest[d]);
    const first = num(oldest[d]);
    const delta = latest - first;
    const direction: TrendDirection = delta > FLAT_BAND ? 'up' : delta < -FLAT_BAND ? 'down' : 'flat';
    return { dimension: d, label: CONSISTENCY_DIM_LABEL[d], latest, first, delta, direction };
  });

  const weakestTrend = trends.reduce((a, b) => (b.latest < a.latest ? b : a));
  const weakest = { dimension: weakestTrend.dimension, label: weakestTrend.label, score: weakestTrend.latest };

  const latest: ConsistencyScoreLike = {
    overall: num(newest.overall),
    continuity: num(newest.continuity),
    lighting: num(newest.lighting),
    face: num(newest.face),
  };

  const arrow = (d: TrendDirection) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '→');
  const trendStr = trends.map((t) => `${t.label} ${t.latest}${list.length > 1 ? arrow(t.direction) : ''}`).join(' · ');
  const message = list.length === 1
    ? `单轮:${trendStr};最弱 ${weakest.label}(${weakest.score})`
    : `${list.length} 轮:${trendStr};最弱 ${weakest.label}(${weakest.score}),较首轮 ${weakestTrend.delta >= 0 ? '+' : ''}${weakestTrend.delta}`;

  return { rounds: list.length, latest, trends, weakest, series: chronological, message };
}
