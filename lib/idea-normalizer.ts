/**
 * lib/idea-normalizer (v2.18)
 *
 * 用户输入的 idea 在交给 Director / Writer 之前过一遍清洗:
 *   1. 规则层 (确定性): 全角转半角 / 多余空白 / 重复标点 / 末尾省略号
 *   2. LLM 层 (可选, idea 较短或线索不足时): 让 LLM 把"一句话创意"扩成
 *      "题材 + 主角 + 冲突 + 转折"四要素的简短提纲, 但**不改原意**, 只补足
 *
 * 触发 LLM 扩写的条件 (满足任一):
 *   - rawIdea < 50 字 (太短, Writer 容易跑偏)
 *   - 检测不到题材关键词 (没"古装/科幻/言情..." 等线索)
 *   - 检测不到主角描述 (没"少年/女主/警察..." 等)
 *   - 检测不到冲突词 (没"复仇/挑战/秘密..." 等)
 *
 * 失败语义:
 *   - LLM 失败 / 超时 / 没 key → 回退到纯规则清洗结果
 *   - 规则清洗永远不抛, 最差返回原文
 *
 * 不做的事:
 *   - 不做安全闸门 (那是 lib/prompt-guardrails.ts 的职责, 调用方在 normalize 之后才走 guardrails)
 *   - 不做麦基扩展 (那是 lib/prompt-templates.ts enhanceIdeaForCreation 的职责)
 *   - 不在每次创作都调 LLM (只在线索不足时才烧 token)
 */

import OpenAI from 'openai';
import { API_CONFIG } from './config';

export interface NormalizeOptions {
  /** 上层 abort */
  signal?: AbortSignal;
  /** 强制走 LLM 扩写 (即便满足规则); 默认 false */
  forceLlmExpand?: boolean;
  /** 强制不走 LLM (即便线索不足, 只走规则); 默认 false */
  ruleOnly?: boolean;
}

export interface NormalizeResult {
  /** 标准化后的 idea, 给后续 prompt-guardrails / prompt-templates / Director 用 */
  normalized: string;
  /** 给前端 toast 的简短说明:做了哪些事 */
  hint: string;
  /** 是不是真的调了 LLM (false = 仅规则) */
  didLlmExpand: boolean;
  /** 检测到的题材标签 — 让前端 chip 能高亮 */
  detectedGenres: string[];
}

// ════════════════════════════════════════════════════════════════════
// 规则层 — 确定性清洗
// ════════════════════════════════════════════════════════════════════

/** 全角转半角 (仅 ASCII 范围, 中文字符不动) */
function fullwidthToHalfwidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0),
  );
}

/** 折叠重复标点 (! ! !! → !)  */
function dedupePunctuation(s: string): string {
  return s
    .replace(/([!?。!?])\1{2,}/g, '$1$1') // 3+ 个相同标点 → 2 个
    .replace(/[，,]{2,}/g, '，')
    .replace(/[.。]{4,}/g, '...')           // 4+ 个点 → 省略号
    .replace(/[ \t]{2,}/g, ' ');           // 多个 [空格/Tab] → 1 个; 注意不要吃换行
}

/** 修剪首尾 + 折叠换行 */
function trimAndFoldLines(s: string): string {
  // 多个换行折叠成 2 个最大
  const folded = s.replace(/\n{3,}/g, '\n\n');
  return folded.trim();
}

/** 确定性规则清洗 — 永不抛 */
export function normalizeIdeaRule(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw;
  s = fullwidthToHalfwidth(s);
  s = dedupePunctuation(s);
  s = trimAndFoldLines(s);
  return s;
}

// ════════════════════════════════════════════════════════════════════
// 题材 / 主角 / 冲突 关键词检测 — 决定要不要走 LLM
// ════════════════════════════════════════════════════════════════════

const GENRE_KEYWORDS = [
  '古装', '宫', '侠', '剑', '秦', '唐', '宋', '明', '清', '武侠',
  '赛博', '未来', '机甲', '外星', '太空', 'AI', '科幻',
  '恋爱', '偶遇', '心动', '表白', '甜宠',
  '破案', '悬疑', '凶手', '失踪', '侦探',
  '职场', '公司', '老板', '创业',
  '校园', '高中', '大学', '宿舍',
  '惊悚', '鬼', '恐怖',
  '动物', '寓言', '童话',
  '美食', '料理', '饭', '菜',
  'MV', '音乐', '舞蹈',
  '历史', '战争', '抗战',
];

const PROTAGONIST_KEYWORDS = [
  '少年', '少女', '女主', '男主', '主角', '主人公',
  '警察', '律师', '医生', '老师', '学生', '记者', '科学家', '探长',
  '剑客', '侠客', '皇子', '将军', '太医',
  '总裁', '员工', '设计师', '艺术家',
  '小猫', '小狗', '小兔子', '小狐狸',
];

const CONFLICT_KEYWORDS = [
  '复仇', '挑战', '秘密', '阴谋', '危机', '灾难', '战争', '对决',
  '失去', '寻找', '逃离', '救赎', '抉择', '背叛',
  '比赛', '竞争', '考验', '困境',
  '突变', '意外', '发现', '揭秘',
];

function detectGenres(text: string): string[] {
  const found = new Set<string>();
  for (const k of GENRE_KEYWORDS) {
    if (text.includes(k)) {
      // 把关键词归类成大类
      if (/古装|宫|侠|剑|秦|唐|宋|明|清|武侠/.test(k)) found.add('古装/武侠');
      else if (/赛博|未来|机甲|外星|太空|AI|科幻/.test(k)) found.add('科幻');
      else if (/恋爱|偶遇|心动|表白|甜宠/.test(k)) found.add('言情');
      else if (/破案|悬疑|凶手|失踪|侦探/.test(k)) found.add('悬疑');
      else if (/职场|公司|老板|创业/.test(k)) found.add('职场');
      else if (/校园|高中|大学|宿舍/.test(k)) found.add('校园');
      else if (/惊悚|鬼|恐怖/.test(k)) found.add('惊悚');
      else if (/动物|寓言|童话/.test(k)) found.add('儿童/寓言');
      else if (/美食|料理|饭|菜/.test(k)) found.add('美食');
      else if (/MV|音乐|舞蹈/.test(k)) found.add('音乐');
      else if (/历史|战争|抗战/.test(k)) found.add('历史');
    }
  }
  return Array.from(found);
}

function hasProtagonistHint(text: string): boolean {
  return PROTAGONIST_KEYWORDS.some((k) => text.includes(k));
}

function hasConflictHint(text: string): boolean {
  return CONFLICT_KEYWORDS.some((k) => text.includes(k));
}

/** idea 是否"信息充足" — 不需要 LLM 扩写 */
export function ideaIsRich(text: string): boolean {
  if (text.length >= 50 && detectGenres(text).length > 0 && (hasProtagonistHint(text) || hasConflictHint(text))) {
    return true;
  }
  // 长文本即使没明确关键词也算够 (用户可能用同义词)
  if (text.length >= 120) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════
// LLM 扩写层
// ════════════════════════════════════════════════════════════════════

const LLM_SYSTEM_PROMPT = `你是一名短剧策划助手。用户给你一句模糊的创意, 你的任务是把它扩展为
一段简短的"创作纲要", 包含 4 个要素:
  1. 题材 (古装/科幻/言情/悬疑/职场/校园/惊悚/儿童/美食/音乐/历史 之一)
  2. 主角 (一句话: 谁, 什么身份)
  3. 核心冲突 (一句话: 主角面对什么困境)
  4. 关键转折 (一句话: 意外出现什么改变)

输出严格 JSON, 不要 markdown 代码块包裹, 不要解释:
  { "expanded": "...", "genre": "..." }

要求:
  - 只补足缺失的, 绝不改变用户原意 — 用户写"咖啡店相遇" 你不能改成"图书馆相遇"
  - 扩写后总长 100-200 字, 自然语言一段, 不分行
  - 不加"主角是XX, 冲突是YY" 这种标签, 直接写流畅的故事描述
  - 不许引入暴力 / 真人色情 / 未成年人色情 / 真实政治人物
  - 如果原文已经够丰富, expanded 就原样返回
  - genre 字段只填一个最匹配的标签, 没合适的填 "未分类"
`;

async function expandWithLlm(
  rawIdea: string,
  signal?: AbortSignal,
): Promise<{ expanded: string; genre: string } | null> {
  if (!API_CONFIG.openai.apiKey) return null;

  const openai = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());

  try {
    const completion = await openai.chat.completions.create(
      {
        model: API_CONFIG.openai.model,
        temperature: 0.6,
        max_tokens: 500,
        messages: [
          { role: 'system', content: LLM_SYSTEM_PROMPT },
          { role: 'user', content: `原始创意:\n${rawIdea}` },
        ],
        response_format: { type: 'json_object' },
      },
      { signal: ctrl.signal },
    );

    const text = completion.choices[0]?.message?.content || '';
    if (!text) return null;
    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch { return null; }

    const expanded = typeof parsed.expanded === 'string' ? parsed.expanded.trim() : '';
    const genre = typeof parsed.genre === 'string' ? parsed.genre.trim() : '未分类';

    // 安全检查: 扩写不能比原文短 (LLM 误把任务理解成"概括")
    if (!expanded || expanded.length < rawIdea.length * 0.8) return null;
    // 也不能离谱地长 (避免 LLM 自我发挥)
    if (expanded.length > 600) return { expanded: expanded.slice(0, 600), genre };

    return { expanded, genre };
  } catch (e) {
    console.warn('[idea-normalizer] LLM expand failed:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ════════════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════════════

export async function normalizeIdea(
  rawIdea: string,
  opts: NormalizeOptions = {},
): Promise<NormalizeResult> {
  // 1. 规则清洗 — 总是跑
  const ruleCleanedRaw = normalizeIdeaRule(rawIdea);

  if (!ruleCleanedRaw) {
    return {
      normalized: '',
      hint: '',
      didLlmExpand: false,
      detectedGenres: [],
    };
  }

  // 2. 决定要不要走 LLM
  const detectedGenres = detectGenres(ruleCleanedRaw);
  const isRich = ideaIsRich(ruleCleanedRaw);

  if (opts.ruleOnly) {
    return {
      normalized: ruleCleanedRaw,
      hint: '已做基础清洗',
      didLlmExpand: false,
      detectedGenres,
    };
  }

  if (!opts.forceLlmExpand && isRich) {
    // 信息充足, 跳过 LLM 节省 token
    return {
      normalized: ruleCleanedRaw,
      hint: detectedGenres.length > 0 ? `已识别题材: ${detectedGenres.join('/')}` : '已做基础清洗',
      didLlmExpand: false,
      detectedGenres,
    };
  }

  // 3. 走 LLM 扩写
  const llmResult = await expandWithLlm(ruleCleanedRaw, opts.signal);
  if (!llmResult) {
    // LLM 失败 → 返回规则结果, 不阻塞主流程
    return {
      normalized: ruleCleanedRaw,
      hint: '已做基础清洗 (LLM 扩写未启用 / 失败, 直接走原文)',
      didLlmExpand: false,
      detectedGenres,
    };
  }

  const finalGenres = llmResult.genre && llmResult.genre !== '未分类'
    ? Array.from(new Set([...detectedGenres, llmResult.genre]))
    : detectedGenres;

  return {
    normalized: llmResult.expanded,
    hint: `已 LLM 扩写为创作纲要 (${llmResult.genre})`,
    didLlmExpand: true,
    detectedGenres: finalGenres,
  };
}
