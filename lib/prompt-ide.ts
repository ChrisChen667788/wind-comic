/**
 * v6.1 — 智能提示词工作台 (Prompt IDE) · 纯逻辑核心 (client-safe, 无 node 依赖)
 *
 * 对标 火山剧创 的提示词编辑: `@` 引用项目资产 + 自动补全 + 编译展开.
 * 这里只做"大脑"(解析/补全/解析引用/编译), 不碰网络/DB —— 资产清单由调用方
 * (编辑器组件 / API) 提供. 编辑器 UI、多模态参考、实时预览留 v6.1.x 接线.
 *
 * 用法:
 *   parseMentions(text)               → 找出 text 里所有 @引用
 *   activeMention(text, caret)        → 光标当前正在敲的那个 @token (驱动补全下拉)
 *   suggestAssets(query, assets)      → 给 query 出候选资产 (排序)
 *   resolveMentions(text, assets)     → 每个 @引用对到哪个资产 (或未解析)
 *   compilePrompt(text, assets)       → 把 @引用替换成资产的展开文本, 交给图像引擎
 */

/** 可被 @ 引用的资产 (角色 / 场景 / 风格 / 道具). expansion = 编译时替换进 prompt 的文本. */
export interface MentionableAsset {
  id: string;
  kind: 'character' | 'scene' | 'style' | 'prop';
  name: string;
  /** @name 在最终 prompt 里展开成什么 (角色身份块 / 场景视觉锚 / 风格关键词...). */
  expansion: string;
}

// `@` 后允许的 token 字符: 任意语言字母/数字/下划线/中点 (覆盖中文名 + 英文 id).
// (?<![\p{L}\p{N}_]) 前瞻: `@` 前不能是字母数字下划线, 避免把 email 的 a@b 误判成引用.
const MENTION_RE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_·]+)/gu;
const TOKEN_CHAR_RE = /[\p{L}\p{N}_·]/u;

export interface Mention {
  /** 含 @ 的原文, 例 "@林小满" */
  raw: string;
  /** 不含 @ 的名字, 例 "林小满" */
  name: string;
  /** 在原文里的起止下标 [start, end) */
  start: number;
  end: number;
}

/** 找出 text 里所有 @引用 (已排除 email 形态的 a@b). */
export function parseMentions(text: string): Mention[] {
  const out: Mention[] = [];
  if (!text) return out;
  for (const m of text.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    out.push({ raw: m[0], name: m[1], start: idx, end: idx + m[0].length });
  }
  return out;
}

export interface ActiveMention {
  /** 已敲入的 token (可能为空 = 刚敲下 @) */
  name: string;
  /** @ 的位置 */
  start: number;
  /** 光标位置 (token 末尾) */
  end: number;
}

/**
 * 光标当前是否正处在一个 @token 内 (用于触发补全). 返回 null = 不在引用里.
 * 规则: 从光标往左扫, 必须先遇到 `@` 且中间全是合法 token 字符; `@` 前不能是字母数字.
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  if (!text) return null;
  const c = Math.max(0, Math.min(caret, text.length));
  let i = c - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      const before = i > 0 ? text[i - 1] : '';
      if (before && /[\p{L}\p{N}_]/u.test(before)) return null; // email 形态, 不算
      return { name: text.slice(i + 1, c), start: i, end: c };
    }
    if (!TOKEN_CHAR_RE.test(ch)) return null; // 遇到分隔符还没碰到 @ → 不在引用里
    i--;
  }
  return null;
}

/**
 * 给 query 出候选资产, 按相关度排序: 全等 > 前缀 > 子串; 平局保持输入顺序 (sort 稳定).
 * query 为空 → 返回前 limit 个 (展示全部可引用资产).
 */
export function suggestAssets(query: string, assets: MentionableAsset[], limit = 8): MentionableAsset[] {
  const q = (query || '').trim().toLowerCase();
  const scored: Array<{ a: MentionableAsset; score: number }> = [];
  for (const a of assets) {
    const n = a.name.toLowerCase();
    let score = -1;
    if (!q) score = 0;
    else if (n === q) score = 3;
    else if (n.startsWith(q)) score = 2;
    else if (n.includes(q)) score = 1;
    if (score >= 0) scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(0, limit)).map((x) => x.a);
}

export interface ResolvedMention {
  mention: Mention;
  asset: MentionableAsset | null;
}

/** 每个 @引用对到哪个资产 (按名字大小写不敏感精确匹配), 没有则 asset=null. */
export function resolveMentions(text: string, assets: MentionableAsset[]): ResolvedMention[] {
  const byName = new Map(assets.map((a) => [a.name.toLowerCase(), a]));
  return parseMentions(text).map((mention) => ({
    mention,
    asset: byName.get(mention.name.toLowerCase()) ?? null,
  }));
}

export interface CompileResult {
  /** 编译后的最终 prompt (@引用已替换成资产展开文本) */
  prompt: string;
  /** 实际用到的资产 (去重, 按出现顺序) */
  used: MentionableAsset[];
  /** 没对上资产的引用名 (去重) —— 编译时降级成裸名字 */
  unresolved: string[];
}

/**
 * 把 text 里的 @引用编译成最终 prompt:
 *   - 命中资产 → 替换成 asset.expansion
 *   - 未命中   → 去掉 @ 保留裸名字 (不让 @ 漏进图像引擎)
 * 其余文本原样保留.
 */
export function compilePrompt(text: string, assets: MentionableAsset[]): CompileResult {
  if (!text) return { prompt: '', used: [], unresolved: [] };
  const byName = new Map(assets.map((a) => [a.name.toLowerCase(), a]));
  const mentions = parseMentions(text);
  const used: MentionableAsset[] = [];
  const usedIds = new Set<string>();
  const unresolved: string[] = [];

  let out = '';
  let cursor = 0;
  for (const m of mentions) {
    out += text.slice(cursor, m.start);
    const asset = byName.get(m.name.toLowerCase());
    if (asset) {
      out += asset.expansion;
      if (!usedIds.has(asset.id)) { usedIds.add(asset.id); used.push(asset); }
    } else {
      out += m.name; // 去掉 @, 留裸名字
      if (!unresolved.includes(m.name)) unresolved.push(m.name);
    }
    cursor = m.end;
  }
  out += text.slice(cursor);
  return { prompt: out, used, unresolved };
}

/**
 * 在补全下拉选中某资产后, 把当前正在敲的 @token 替换成完整的 `@name `(末尾加空格便于继续敲).
 * 返回新文本 + 新光标位置 (供组件 setSelectionRange). 纯函数.
 */
export function insertMention(
  text: string,
  active: { start: number; end: number },
  assetName: string,
): { text: string; caret: number } {
  const before = text.slice(0, active.start);
  const after = text.slice(active.end);
  const insert = `@${assetName} `;
  return { text: before + insert + after, caret: (before + insert).length };
}
