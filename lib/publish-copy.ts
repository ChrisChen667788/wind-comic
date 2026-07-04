/**
 * 发布文案生成(v12.84.0)——成片配套的平台发布素材。
 *
 * 出片只是半程:发抖音/小红书还要标题、话题标签、封面题。本模块:
 *   - buildPublishCopyPrompt(纯函数):从 plan/script 组 LLM 提示
 *   - parsePublishCopy(纯函数):解析 + 截断 + 结构校验
 *   - 生成后必过《广告法》净化(标题/封面题是最容易踩线的位置)
 * LLM 走 callLLMWithFallback(主→MiniMax 兜底,与全链一致)。
 */
import { sanitizeAdCopy } from '@/lib/ad-compliance';

export interface PublishCopy {
  titles: string[];      // 3 条候选标题(≤30 字)
  hashtags: string[];    // ≤8 个话题(不带 #)
  coverTitle: string;    // 封面大字(≤12 字)
}

export function buildPublishCopyPrompt(input: { idea?: string; genre?: string; synopsis?: string; dialogues?: string[] }): { system: string; user: string } {
  const system =
    '你是短视频运营。为一条竖屏广告成片写发布素材,严格只输出 JSON(不要 markdown):' +
    '{"titles":["3 条候选标题,每条≤30字,带钩子但不夸大"],"hashtags":["≤8 个话题词,不带#号"],"coverTitle":"封面大字≤12字"}' +
    '。禁止《广告法》违禁词(最/第一/顶级/根治等)。';
  const user =
    `创意:${(input.idea || '').slice(0, 300)}\n题材:${input.genre || ''}\n` +
    `梗概:${(input.synopsis || '').slice(0, 200)}\n台词摘录:${(input.dialogues || []).slice(0, 5).join(' / ').slice(0, 200)}`;
  return { system, user };
}

/**
 * v12.99.0 文案变体矩阵(对标 marketingskills Ad Creative:20+ 变体×3 形态)。
 * 短(信息流标题)×8 / 中(标题+正文)×8 / 长(种草长文)×4 = 20 条,全过合规净化。
 */
export interface CopyMatrix {
  short: string[];                                  // ≤20 字 ×8
  medium: Array<{ title: string; body: string }>;   // 标题≤20 + 正文≤60 ×8
  long: string[];                                   // ≤300 字种草文 ×4
}

export function buildCopyMatrixPrompt(input: { idea?: string; genre?: string; synopsis?: string }): { system: string; user: string } {
  const system =
    '你是电商投放文案。为一条竖屏广告写发布文案矩阵,严格只输出 JSON:' +
    '{"short":["8 条信息流短标题,每条≤20字,钩子各不同(痛点/好奇/数字/反差)"],' +
    '"medium":[{"title":"≤20字","body":"≤60字正文"} 共 8 条],' +
    '"long":["4 条小红书风种草长文,每条≤300字,口语化第一人称"]}' +
    '。禁止《广告法》违禁词(最/第一/顶级/根治等)。';
  const user = `创意:${(input.idea || '').slice(0, 300)}\n题材:${input.genre || ''}\n梗概:${(input.synopsis || '').slice(0, 200)}`;
  return { system, user };
}

export function parseCopyMatrix(raw: string): CopyMatrix | null {
  let j: any;
  try { j = JSON.parse(raw); } catch {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { j = JSON.parse(m[0]); } catch { return null; }
  }
  if (!j || !Array.isArray(j.short)) return null;
  const clean = (s: unknown, max: number): string => sanitizeAdCopy(String(s ?? '').trim()).text.slice(0, max);
  const short = j.short.map((t: unknown) => clean(t, 20)).filter(Boolean).slice(0, 8);
  const medium = (Array.isArray(j.medium) ? j.medium : [])
    .map((m: any) => ({ title: clean(m?.title, 20), body: clean(m?.body, 60) }))
    .filter((m: any) => m.title && m.body)
    .slice(0, 8);
  const long = (Array.isArray(j.long) ? j.long : []).map((t: unknown) => clean(t, 300)).filter(Boolean).slice(0, 4);
  if (short.length === 0) return null;
  return { short, medium, long };
}

/**
 * v12.86.0 Hook 创意生成(A/B 变体的弹药)。公式约束写进 prompt:
 * 痛点问句 / 反常识陈述 / 数字利益点,每条 ≤14 字(卡片上限 16 留余量)。
 */
export function buildHookIdeasPrompt(input: { idea?: string; genre?: string; synopsis?: string }): { system: string; user: string } {
  const system =
    '你是短视频投放操盘手。为一条竖屏广告写 5 条开场 Hook(头 2 秒的卡片大字),严格只输出 JSON:' +
    '{"hooks":["每条≤14字,优先痛点问句(带?),其次反常识陈述/数字利益点"]}' +
    '。禁止《广告法》违禁词,禁止换行。';
  const user = `创意:${(input.idea || '').slice(0, 300)}\n题材:${input.genre || ''}\n梗概:${(input.synopsis || '').slice(0, 200)}`;
  return { system, user };
}

/** 解析 hooks:抠 JSON → 逐条净化 → 2-16 字/无换行过滤 → 去重 → ≤5 条。非法 → null。 */
export function parseHookIdeas(raw: string): string[] | null {
  let j: any;
  try { j = JSON.parse(raw); } catch {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { j = JSON.parse(m[0]); } catch { return null; }
  }
  if (!j || !Array.isArray(j.hooks)) return null;
  const seen = new Set<string>();
  const hooks = j.hooks
    .map((h: unknown) => sanitizeAdCopy(String(h ?? '').trim()).text)
    .filter((h: string) => h.length >= 2 && h.length <= 16 && !/[\r\n]/.test(h))
    .filter((h: string) => (seen.has(h) ? false : (seen.add(h), true)))
    .slice(0, 5);
  return hooks.length > 0 ? hooks : null;
}

/** 解析 LLM 返回(容忍 markdown 包裹/杂文),结构校验 + 截断 + 合规净化。非法 → null。 */
export function parsePublishCopy(raw: string): PublishCopy | null {
  let j: any;
  try { j = JSON.parse(raw); } catch {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { j = JSON.parse(m[0]); } catch { return null; }
  }
  if (!j || !Array.isArray(j.titles) || j.titles.length === 0) return null;
  const clean = (s: unknown, max: number): string => sanitizeAdCopy(String(s ?? '').trim()).text.slice(0, max);
  const titles = j.titles.map((t: unknown) => clean(t, 30)).filter(Boolean).slice(0, 3);
  const hashtags = (Array.isArray(j.hashtags) ? j.hashtags : [])
    .map((t: unknown) => clean(t, 16).replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 8);
  const coverTitle = clean(j.coverTitle, 12);
  if (titles.length === 0) return null;
  return { titles, hashtags, coverTitle };
}
