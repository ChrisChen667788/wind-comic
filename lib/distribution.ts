/**
 * v9.1 — 分发 / 变现闭环 (纯逻辑, 单测覆盖).
 *
 * 把一部成片 (synopsis + 题材 + 钩子 + 情绪峰值) → 各平台的「分发包」提示词,
 * 再把 LLM 产出解析成结构化 marketing pack (标题候选 / 标签 / 钩子文案 / 简介 / 发布建议)。
 *
 * 平台规格 (字数/标签数/话术风格) 各异, 解析后按规格 clamp。容错: JSON 失败 → 正则兜底 → 降级。
 *
 * 单测: tests/v9-1-distribution.test.ts.
 */

export type PlatformId = 'douyin' | 'kuaishou' | 'shipinhao' | 'xiaohongshu' | 'youtube_shorts' | 'bilibili' | 'tiktok';

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  /** 标题字数上限 (中文按字计). */
  titleMaxLen: number;
  /** 标签数量上限. */
  tagCount: number;
  /** 简介字数上限. */
  descMaxLen: number;
  /** 画幅建议. */
  aspect: '9:16' | '16:9' | '1:1';
  /** 平台话术风格提示 (喂给 LLM). */
  toneHint: string;
}

export const PLATFORM_SPECS: PlatformSpec[] = [
  { id: 'douyin', label: '抖音', titleMaxLen: 55, tagCount: 5, descMaxLen: 200, aspect: '9:16', toneHint: '前3秒强钩子, 悬念+情绪词, 口语化, 带#话题' },
  { id: 'kuaishou', label: '快手', titleMaxLen: 50, tagCount: 5, descMaxLen: 200, aspect: '9:16', toneHint: '接地气, 反转剧透半句, 老铁感, 带#话题' },
  { id: 'shipinhao', label: '视频号', titleMaxLen: 22, tagCount: 3, descMaxLen: 120, aspect: '9:16', toneHint: '短促有力, 社交转发钩子, 克制不标题党' },
  { id: 'xiaohongshu', label: '小红书', titleMaxLen: 20, tagCount: 8, descMaxLen: 300, aspect: '9:16', toneHint: '种草笔记体, emoji 点缀, 多标签, 第一人称安利' },
  { id: 'youtube_shorts', label: 'YouTube Shorts', titleMaxLen: 100, tagCount: 5, descMaxLen: 300, aspect: '9:16', toneHint: 'English hook-first, curiosity gap, #Shorts hashtags' },
  { id: 'bilibili', label: 'B站', titleMaxLen: 80, tagCount: 6, descMaxLen: 250, aspect: '16:9', toneHint: 'ACG/二次元友好, 梗+悬念, 分区标签, 三连引导' },
  { id: 'tiktok', label: 'TikTok', titleMaxLen: 100, tagCount: 5, descMaxLen: 300, aspect: '9:16', toneHint: 'English hook-first, fast-paced, trending #hashtags, CTA to follow' },
];

const SPEC_BY_ID = new Map(PLATFORM_SPECS.map((s) => [s.id, s]));

export function getPlatformSpec(id: string): PlatformSpec | null {
  return SPEC_BY_ID.get(id as PlatformId) ?? null;
}

export function isPlatformId(id: string): id is PlatformId {
  return SPEC_BY_ID.has(id as PlatformId);
}

export interface DistributionInput {
  title: string;
  synopsis: string;
  genre?: string;
  /** 钩子/反转点 (来自节奏审计), 给标题/钩子文案灵感. */
  hooks?: string[];
  /** 情绪峰值描述 (来自情绪曲线). */
  emotionPeak?: string;
  platforms: PlatformId[];
}

/** 构造分发包提示词 (要求 LLM 输出严格 JSON). */
export function buildDistributionPrompt(input: DistributionInput): string {
  const platforms = input.platforms.filter(isPlatformId);
  const used = platforms.length > 0 ? platforms : (['douyin'] as PlatformId[]);
  const specLines = used.map((p) => {
    const s = SPEC_BY_ID.get(p)!;
    return `  - "${s.id}" (${s.label}): 标题≤${s.titleMaxLen}字, ${s.tagCount}个标签, 简介≤${s.descMaxLen}字, 风格: ${s.toneHint}`;
  }).join('\n');

  const hookLine = input.hooks && input.hooks.length ? `\n钩子/反转: ${input.hooks.slice(0, 5).join(' / ')}` : '';
  const emoLine = input.emotionPeak ? `\n情绪峰值: ${input.emotionPeak}` : '';

  return [
    '你是短剧分发运营专家。基于下面这部成片, 为每个平台产出一套「分发包」。',
    '',
    `片名: ${input.title}`,
    `题材: ${input.genre || '未指定'}`,
    `梗概: ${input.synopsis}`,
    `${hookLine}${emoLine}`,
    '',
    '目标平台 (各自规格):',
    specLines,
    '',
    '为每个平台产出: 3 个标题候选 (前一个最优, 不超字数, 强钩子) / 标签数组 (不带#) / 1 句封面钩子文案 / 1 段简介 / 1 条发布建议 (最佳时段/形式)。',
    '严格只输出 JSON, 形如:',
    '{"platforms":{"<平台id>":{"titles":["..."],"tags":["..."],"hook":"...","description":"...","tips":"..."}}}',
    '不要输出 JSON 以外任何文字。',
  ].join('\n');
}

export interface PlatformPack {
  platform: PlatformId;
  label: string;
  titles: string[];
  tags: string[];
  hook: string;
  description: string;
  tips: string;
}

export interface DistributionPack {
  platforms: PlatformPack[];
  /** 解析是否走了兜底 (JSON 失败). */
  degraded: boolean;
}

function clampLen(s: unknown, max: number): string {
  const str = typeof s === 'string' ? s.trim() : '';
  return str.length > max ? str.slice(0, max) : str;
}

function normTags(raw: unknown, max: number): string[] {
  let arr: string[] = [];
  if (Array.isArray(raw)) arr = raw.map((t) => String(t));
  else if (typeof raw === 'string') arr = raw.split(/[,，#\s]+/);
  return Array.from(new Set(
    arr.map((t) => t.replace(/^#/, '').trim()).filter(Boolean),
  )).slice(0, max);
}

function packForPlatform(spec: PlatformSpec, data: any): PlatformPack {
  const titlesRaw: unknown[] = Array.isArray(data?.titles) ? data.titles : (data?.title ? [data.title] : []);
  const titles = titlesRaw.map((t) => clampLen(t, spec.titleMaxLen)).filter(Boolean).slice(0, 3);
  return {
    platform: spec.id,
    label: spec.label,
    titles: titles.length ? titles : [clampLen(data?.hook || '', spec.titleMaxLen) || '（待补标题）'],
    tags: normTags(data?.tags, spec.tagCount),
    hook: clampLen(data?.hook, 60),
    description: clampLen(data?.description ?? data?.desc, spec.descMaxLen),
    tips: clampLen(data?.tips, 120),
  };
}

/** 从 LLM 原文解析分发包. JSON 优先, 失败 → 提取首个 {...} 再试, 仍失败 → 空降级. */
export function parseDistributionPack(raw: string, platforms: PlatformId[]): DistributionPack {
  const wanted = platforms.filter(isPlatformId);
  const used = wanted.length ? wanted : (['douyin'] as PlatformId[]);

  let parsed: any = null;
  let degraded = false;
  if (raw && typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* fall through */ } }
    }
  }
  if (!parsed || typeof parsed !== 'object') { degraded = true; parsed = {}; }

  const byPlatform = parsed.platforms && typeof parsed.platforms === 'object' ? parsed.platforms : parsed;

  const packs = used.map((p) => {
    const spec = SPEC_BY_ID.get(p)!;
    const data = byPlatform?.[p] ?? byPlatform?.[spec.label] ?? {};
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) degraded = true;
    return packForPlatform(spec, data || {});
  });

  return { platforms: packs, degraded };
}

/** 把分发包导出成可复制的纯文本 (按平台分段). */
export function distributionPackToText(pack: DistributionPack): string {
  return pack.platforms.map((p) => {
    const lines = [
      `【${p.label}】`,
      `标题: ${p.titles[0] || ''}`,
      p.titles.length > 1 ? `备选: ${p.titles.slice(1).join(' | ')}` : '',
      `标签: ${p.tags.map((t) => '#' + t).join(' ')}`,
      p.hook ? `钩子: ${p.hook}` : '',
      p.description ? `简介: ${p.description}` : '',
      p.tips ? `建议: ${p.tips}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n\n');
}
