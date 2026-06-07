/**
 * lib/cost-attribution (v9.6.0) — 阶段十六开篇:成片成本归因(单项目 / 单次生成的逐阶段成本拆解)。
 *
 * 把一次创作的各阶段开销(LLM 编剧/导演 · 图像分镜 · 视频 · TTS · 口型)归因到类目,
 * 算出总价 + 各类目占比 + 最贵类目 + 针对性省钱提示。与 `cost-rollup`(月度聚合)正交:
 * 这是「这一单钱花在哪、怎么省」的**项目级**视图。纯逻辑、解耦、client 可直引。
 * 单测 tests/v9-6-0-cost-attribution.test.ts。
 */

export type CostCategory = 'llm' | 'image' | 'video' | 'tts' | 'lipsync' | 'other';

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  llm: 'LLM(编剧/导演)',
  image: '图像分镜',
  video: '视频生成',
  tts: '配音 TTS',
  lipsync: '口型',
  other: '其它',
};

const ALL_CATS: CostCategory[] = ['llm', 'image', 'video', 'tts', 'lipsync', 'other'];

/**
 * 把 cost_log 的 `engine` 字符串归类到成本类目(v9.6.5,接真实计费数据)。
 * 顺序敏感:口型 > TTS > 视频 > 图像 > LLM(避免 "gpt-sovits" 误判成 LLM)。
 */
export function classifyEngineCategory(engine: string): CostCategory {
  const e = (engine || '').toLowerCase();
  if (!e) return 'other';
  if (/lip|wav2lip|sadtalker|musetalk|viseme|talkinghead/.test(e)) return 'lipsync';
  if (/tts|speech|sovits|cosyvoice|voice|f5-|edge-tts|azure-tts|elevenlabs|audio/.test(e)) return 'tts';
  if (/video|kling|hailuo|s2v|flf|cogvideo|runway|veo|seedance|wan-|hunyuan-video|t2v|i2v|minimax-video|vidu/.test(e)) return 'video';
  if (/image|img|flux|sdxl|sd-|stable-diffusion|kontext|qwen-image|seedream|dalle|gpt-image|midjourney|ideogram|recraft|nano-banana|janus|seededit/.test(e)) return 'image';
  if (/gpt|claude|qwen|deepseek|glm|llama|gemini|moonshot|kimi|doubao|ernie|spark|yi-|abab|o1|o3|grok|chat|llm|text/.test(e)) return 'llm';
  return 'other';
}

/** 把 cost_log 行(engine + costCny)映射成计费事件(category 由 engine 归类)。 */
export function costEventsFromCostLog(
  rows: Array<{ engine?: string | null; costCny?: number | null }>,
): CostEvent[] {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    category: classifyEngineCategory(r?.engine || ''),
    costCny: num(r?.costCny),
    label: (r?.engine || '').trim() || undefined,
  }));
}

export interface CostEvent {
  category: CostCategory;
  costCny: number;
  /** 可选:哪一步 / 哪镜 */
  label?: string;
}

export interface CategoryCost {
  category: CostCategory;
  label: string;
  costCny: number;
  /** 占总价百分比(0-100,1 位小数) */
  pct: number;
  /** 该类目有效计费事件数 */
  count: number;
}

export interface CostAttribution {
  totalCny: number;
  /** 降序(贵的在前),只含 >0 的类目 */
  byCategory: CategoryCost[];
  topCategory: CategoryCost | null;
  /** 省钱提示(中文) */
  hints: string[];
}

function num(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 省钱提示规则:按最贵类目给针对性建议。 */
function buildHints(byCategory: CategoryCost[], total: number): string[] {
  if (total <= 0) return ['尚无成本数据 — 跑一单生成后即可看成本归因'];
  const top = byCategory[0];
  if (!top) return [];
  const hints: string[] = [];
  const pct = top.pct;
  if (top.category === 'video' && pct >= 50) hints.push(`视频生成占 ${pct}% —— 缩短单镜时长 / 降帧率 / 多引擎竞速取最快达标,可显著省`);
  else if (top.category === 'image' && pct >= 40) hints.push(`图像分镜占 ${pct}% —— 复用 Style Bible + cref 链减少重生、Vision 自愈只重拍弱镜`);
  else if (top.category === 'llm' && pct >= 40) hints.push(`LLM 占 ${pct}% —— 非关键步走 flash 档、缓存已定稿剧本`);
  else if (top.category === 'tts' && pct >= 30) hints.push(`TTS 占 ${pct}% —— 旁白合并合成、对白短句批量`);
  else hints.push(`最大头是「${top.label}」(${pct}%)`);

  const video = byCategory.find((c) => c.category === 'video');
  if (video && video.pct >= 30 && top.category !== 'video') hints.push(`视频也占 ${video.pct}%,是第二大头,可优先优化`);
  return hints;
}

/**
 * 把一组计费事件归因到类目:总价 + 各类目占比(降序)+ 最贵类目 + 省钱提示。
 */
export function attributeCost(events: CostEvent[]): CostAttribution {
  const list = Array.isArray(events) ? events : [];
  const sums: Record<CostCategory, { cost: number; count: number }> = {
    llm: { cost: 0, count: 0 }, image: { cost: 0, count: 0 }, video: { cost: 0, count: 0 },
    tts: { cost: 0, count: 0 }, lipsync: { cost: 0, count: 0 }, other: { cost: 0, count: 0 },
  };
  for (const e of list) {
    if (!e) continue;
    const cat: CostCategory = ALL_CATS.includes(e.category) ? e.category : 'other';
    const c = num(e.costCny);
    sums[cat].cost += c;
    if (c > 0) sums[cat].count += 1;
  }
  const total = ALL_CATS.reduce((n, c) => n + sums[c].cost, 0);
  const byCategory: CategoryCost[] = ALL_CATS
    .map((c) => ({
      category: c,
      label: COST_CATEGORY_LABEL[c],
      costCny: round2(sums[c].cost),
      pct: total > 0 ? round1((sums[c].cost / total) * 100) : 0,
      count: sums[c].count,
    }))
    .filter((c) => c.costCny > 0)
    .sort((a, b) => b.costCny - a.costCny);

  return {
    totalCny: round2(total),
    byCategory,
    topCategory: byCategory[0] ?? null,
    hints: buildHints(byCategory, total),
  };
}

// ─── v9.7.17 成本预算护栏 ───────────────────────────────────────────────────

export type CostGuardLevel = 'none' | 'ok' | 'warn' | 'over';

export interface CostGuard {
  level: CostGuardLevel;
  capCny: number | null;
  totalCny: number;
  /** 已用占比 0-100+(无上限 → null) */
  pctUsed: number | null;
  remainingCny: number | null;
  /** 告警阈值 0..1(默认 0.8) */
  warnThreshold: number;
  message: string;
}

/**
 * 项目级成本预算护栏:已花 vs 上限 → ok / warn(≥阈值)/ over(≥上限);无上限 → none。
 * 与 cost-rollup.computeBudget(周期+线性预测)正交:这是单项目累计花费的硬上限护栏。
 */
export function evaluateCostGuard(input: { totalCny: number; capCny?: number | null; warnThreshold?: number }): CostGuard {
  const total = round2(num(input.totalCny));
  const cap = input.capCny == null ? null : num(input.capCny);
  const warn = typeof input.warnThreshold === 'number' && input.warnThreshold > 0 && input.warnThreshold <= 1 ? input.warnThreshold : 0.8;
  if (cap == null || cap <= 0) {
    return { level: 'none', capCny: cap, totalCny: total, pctUsed: null, remainingCny: null, warnThreshold: warn, message: '未设预算上限' };
  }
  const pctUsed = round1((total / cap) * 100);
  const remainingCny = round2(cap - total);
  const level: CostGuardLevel = total >= cap ? 'over' : total >= cap * warn ? 'warn' : 'ok';
  const message =
    level === 'over' ? `已超预算 ¥${total} / ¥${cap}(${pctUsed}%)`
      : level === 'warn' ? `接近预算 ${pctUsed}%(剩 ¥${remainingCny})`
        : `预算内 ${pctUsed}%(剩 ¥${remainingCny})`;
  return { level, capCny: cap, totalCny: total, pctUsed, remainingCny, warnThreshold: warn, message };
}
