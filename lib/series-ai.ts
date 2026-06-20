/**
 * AI 自动拆集(阶段二十六 · v12.21.0)—— 一句系列设定 → N 集梗概(LLM)。
 *
 * 之前建系列要手填每集 premise;本模块用创意 LLM 把「系列设定 + 集数」拆成各集梗概
 * (递进 + 留钩子 + 跨集连贯)。解析容错(剥 think/```fence、兼容多种 JSON 形状)做成纯函数,可单测。
 */

import { callLLMWithFallback, stripThink } from '@/lib/llm-client';
import type { EpisodeOutline } from '@/lib/series';

export function buildSplitSystemPrompt(): string {
  return [
    '你是资深系列剧/短剧编剧。把用户给的「一句系列设定」拆成连贯的多集大纲。',
    '要求:① 每集一个清晰的剧情梗概(40-120 字),有本集冲突与小高潮;',
    '② 集与集递进,前后呼应,集尾留钩子;③ 全系列共享同一批主角与世界观(跨集一致);',
    '④ 只输出 JSON,不要任何解释。',
    '输出格式:{"episodes":[{"title":"本集标题(≤12字)","premise":"本集剧情梗概"}, ...]}',
  ].join('\n');
}

export function buildSplitUserPrompt(premise: string, count: number): string {
  const n = Math.max(1, Math.min(50, Math.floor(count) || 1));
  return `系列设定:${(premise || '').trim()}\n\n请拆成 ${n} 集,输出 ${n} 个 episodes。`;
}

/** 剥 ```json fence。 */
function stripFences(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
}

/**
 * 解析 LLM 输出 → EpisodeOutline[]。容错:剥 <think>/fence;兼容 {episodes:[…]} / 顶层数组 /
 * {集:[…]};premise 兼容 premise|summary|outline|desc|梗概;过滤空;按 max 截断。纯函数。
 */
export function parseEpisodeOutlines(content: string, max?: number): EpisodeOutline[] {
  if (!content) return [];
  let obj: any = null;
  try { obj = JSON.parse(stripFences(stripThink(content))); } catch { return []; }
  const arr: any[] = Array.isArray(obj)
    ? obj
    : (Array.isArray(obj?.episodes) ? obj.episodes : (Array.isArray(obj?.集) ? obj.集 : []));
  const out: EpisodeOutline[] = [];
  for (const it of arr) {
    if (!it) continue;
    const premise = String(it.premise ?? it.summary ?? it.outline ?? it.desc ?? it.梗概 ?? it.剧情 ?? '').trim();
    if (!premise) continue;
    const title = String(it.title ?? it.name ?? it.标题 ?? '').trim() || undefined;
    out.push({ title, premise });
  }
  return max && max > 0 ? out.slice(0, max) : out;
}

/** 一句系列设定 → N 集梗概(创意 LLM,jsonMode)。失败抛错(调用方决定降级)。 */
export async function splitSeriesIntoEpisodes(premise: string, count: number): Promise<EpisodeOutline[]> {
  const res = await callLLMWithFallback({
    system: buildSplitSystemPrompt(),
    user: buildSplitUserPrompt(premise, count),
    useCreative: true,
    jsonMode: true,
    maxTokens: 2400,
    temperature: 0.8,
  });
  if (!res.ok || !res.content) throw new Error('AI 拆集失败:' + (res.error || 'LLM 无返回'));
  const eps = parseEpisodeOutlines(res.content, count);
  if (eps.length === 0) throw new Error('AI 拆集失败:未解析出有效分集');
  return eps;
}
