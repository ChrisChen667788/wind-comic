/**
 * Screenwriter enhancement primitives
 *
 * 背景调研 (2026-04):
 *   商业产品:
 *     - Sudowrite Muse / Story Bible — 角色/设定卡片按需 RAG 注入
 *     - NovelCrafter — 章节级 "Codex"(世界书)绑定 + Matter(片段)引用
 *     - Final Draft Beat Board + ChatGPT 外接 — 情节节拍卡片驱动
 *
 *   开源 / 论文:
 *     - DeepMind Dramatron (Apache-2.0) — 分层 prompt chain: logline → title
 *       → characters → plot → location → dialogue (2022, arXiv:2209.14958)
 *     - THUDM LongWriter / AgentWrite — 按小节下达字数预算,解决
 *       "末尾崩塌" (2024, arXiv:2408.07055)
 *     - StoryWriter — Outline / Planning / Writing 三 agent + ReIO 反写
 *       (2024, arXiv:2411.02098)
 *     - Dramaturge iterative refinement — 评论 → 改写 循环,+22~57% 质量
 *       (2024, arXiv:2411.18416)
 *     - anthropics/skills — Claude Skills 参考实现 (SKILL.md + kebab-case
 *       交叉引用),2025-10
 *
 *   我们的整合策略 (全部是 prompt 层可插拔模块,不改底层 LLM 调用):
 *     1. Voice Fingerprint — 每角色"口头禅 / 禁词 / 语域"卡片,对抗 LLM
 *        的"所有人说话一样"倾向 (Sudowrite Story Bible 简化版)
 *     2. Story Bible Block — 项目级一致性索引,复读防漂 (Sudowrite /
 *        NovelCrafter Codex 思路)
 *     3. Budget Plan — 按 scene 分配字数/情感温度目标 (LongWriter AgentWrite)
 *     4. Critic Prompt — 基于麦基 11 维 + 主角弧光的评分器 (Dramaturge)
 *     5. Critic-Rewrite Loop Driver — 调度器封装,上层只管拿结果
 *
 *   注意: 这些原语是"渐进注入"——旧的 runWriter 不改动也能跑,只把它们当
 *   可选 block 拼到 userContext / systemPrompt 里即可。
 */

// ─────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────

export interface VoiceFingerprint {
  /** 角色名 */
  name: string;
  /** 1-3 句话的"说话感觉"定义，比"性格"更具操作性 */
  voiceStyle: string;
  /** 最爱挂嘴边的 2-5 个短语/口头禅,反复出现 */
  catchphrases: string[];
  /** 这个角色绝不说的词或绝不做的事(给负向约束) */
  forbidden: string[];
  /** 典型句长: short(<8字) / medium(8-20) / long(>20) */
  sentenceLength?: 'short' | 'medium' | 'long';
  /** 语域: formal / neutral / colloquial / slang / archaic */
  register?: 'formal' | 'neutral' | 'colloquial' | 'slang' | 'archaic';
  /** 说话时习惯性的小动作(为 storyboard 提供 cue) */
  tic?: string;
}

export interface StoryBibleEntry {
  /** 条目名:角色名 / 地点名 / 设定概念 */
  name: string;
  /** 类型 */
  type: 'character' | 'location' | 'concept' | 'item';
  /** 1-3 句话的不可违背事实(canonical facts) */
  facts: string[];
  /** 禁忌/一致性红线(比如"主角右手有疤,永远不能画左手有疤") */
  consistency?: string[];
}

export interface SceneBudget {
  sceneId: string;
  /** 占全篇比例 0-1,之和应接近 1 */
  weight: number;
  /** 本场景目标情感温度 -10 ~ +10 */
  emotionTemp: number;
  /** 本场景目标镜头数 */
  shotCount: number;
  /** 在三幕中的位置 */
  act: 1 | 2 | 3;
  /** 是否关键节点 */
  keyBeat?: 'hook' | 'inciting-incident' | 'midpoint' | 'climax' | 'denouement';
}

export interface CriticFeedback {
  /** 0-100 的综合分数 */
  score: number;
  /** 11 个维度的子分数 */
  dimensions: {
    hook: number;          // 黄金开场
    threeAct: number;       // 三幕结构
    incitingIncident: number; // 激励事件
    midpoint: number;       // 中点反转
    climax: number;         // 高潮选择
    emotionCurve: number;   // 情感曲线起伏
    valueShift: number;     // 价值转换
    expectationGap: number; // 期望鸿沟
    voice: number;          // 角色声音区分度
    pacing: number;         // 节奏
    consistency: number;    // 设定一致性
  };
  /** 需要改的点(按优先级排序的具体 actionable) */
  fixes: string[];
  /** 必须保留的亮点(不要改丢) */
  keep: string[];
}

// ─────────────────────────────────────────────────────────────────
// 1. Voice Fingerprint — 角色声音指纹
// ─────────────────────────────────────────────────────────────────

/**
 * 渲染 Voice Fingerprint 卡片块,供 writer prompt 注入。
 * 核心信条: 与其给 LLM 长段的"角色性格描述",不如给它 4-5 条可验证的规则。
 */
export function buildVoiceFingerprintBlock(voices: VoiceFingerprint[]): string {
  if (!voices || voices.length === 0) return '';

  const cards = voices.map((v) => {
    const lines: string[] = [`▸ ${v.name}`];
    lines.push(`  · 声音: ${v.voiceStyle}`);
    if (v.catchphrases?.length) {
      lines.push(`  · 口头禅(要反复用): ${v.catchphrases.map((p) => `「${p}」`).join(' / ')}`);
    }
    if (v.forbidden?.length) {
      lines.push(`  · 禁词/禁行为(绝不说/绝不做): ${v.forbidden.join('、')}`);
    }
    const lenMap = { short: '短句 <8 字', medium: '中句 8-20 字', long: '长句 >20 字' };
    if (v.sentenceLength) lines.push(`  · 句长习惯: ${lenMap[v.sentenceLength]}`);
    if (v.register) {
      const regMap = {
        formal: '正式',
        neutral: '中性',
        colloquial: '口语',
        slang: '俚语',
        archaic: '古雅',
      };
      lines.push(`  · 语域: ${regMap[v.register]}`);
    }
    if (v.tic) lines.push(`  · 小动作: ${v.tic}`);
    return lines.join('\n');
  }).join('\n\n');

  return `\n═══ 角色声音指纹(Voice Fingerprint,必须严格遵守) ═══\n每个角色的台词都必须符合下列声音卡。写台词时请在心里默念这个角色的口头禅,让不同角色的对白"一眼能听出谁在说话"。\n\n${cards}\n\n⚠️ 声音违规清单(你绝不能犯):\n1. 所有角色用同一种说话节奏\n2. 让某角色说他/她的"禁词"\n3. 整篇完全不出现任何一个"口头禅"\n4. 台词失去角色识别度,换个名字也能说\n═══════════════════════════════════════════\n`;
}

/**
 * 从 Director plan 的 characters[] 自动生成保底的 VoiceFingerprint。
 * 当用户没填声音卡时,用 description 启发式生成一个最小可用版。
 */
export function inferVoiceFingerprintsFromCharacters(
  characters: Array<{ name: string; description?: string; appearance?: string }>,
): VoiceFingerprint[] {
  if (!characters) return [];

  return characters.map((c) => {
    const desc = (c.description || '').toLowerCase();
    let voiceStyle = '自然的中性表达';
    let sentenceLength: VoiceFingerprint['sentenceLength'] = 'medium';
    let register: VoiceFingerprint['register'] = 'neutral';

    // 启发式:根据 description 关键词猜测
    if (/严肃|冷|沉默|寡言|理性/.test(desc)) {
      voiceStyle = '克制、省字,用名词和动词多于形容词';
      sentenceLength = 'short';
    } else if (/热情|活泼|话痨|外向/.test(desc)) {
      voiceStyle = '情绪外放,常带感叹/反问';
      sentenceLength = 'long';
      register = 'colloquial';
    } else if (/古|侠|将军|皇|帝|仙/.test(desc) || /古|侠|将军|皇|帝|仙/.test(c.appearance || '')) {
      voiceStyle = '古雅、端庄,避免现代词';
      register = 'archaic';
    } else if (/孩|童|少年|少女/.test(desc)) {
      voiceStyle = '天真直接,常用感叹词和重复';
      register = 'colloquial';
      sentenceLength = 'short';
    }

    return {
      name: c.name,
      voiceStyle,
      catchphrases: [],  // 默认为空,由 LLM 在写作时自创
      forbidden: [],
      sentenceLength,
      register,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// 2. Story Bible — 项目级一致性索引
// ─────────────────────────────────────────────────────────────────

/**
 * 渲染 Story Bible 卡片块。
 * Sudowrite / NovelCrafter 的核心洞察: 一致性崩坏 80% 来自"LLM 忘了之前定过的事实"
 * 所以每次生成都要显式复读关键事实条目(不是全量,是按需注入)。
 */
export function buildStoryBibleBlock(entries: StoryBibleEntry[]): string {
  if (!entries || entries.length === 0) return '';

  const byType = {
    character: entries.filter((e) => e.type === 'character'),
    location: entries.filter((e) => e.type === 'location'),
    concept: entries.filter((e) => e.type === 'concept'),
    item: entries.filter((e) => e.type === 'item'),
  };

  const sections: string[] = [];
  const typeLabel = {
    character: '【角色】',
    location: '【地点】',
    concept: '【设定】',
    item: '【道具】',
  };

  (['character', 'location', 'concept', 'item'] as const).forEach((t) => {
    if (byType[t].length === 0) return;
    const cards = byType[t].map((e) => {
      const lines: string[] = [`◇ ${e.name}`];
      e.facts.forEach((f) => lines.push(`    · ${f}`));
      if (e.consistency?.length) {
        lines.push(`    · [红线] ${e.consistency.join(' | ')}`);
      }
      return lines.join('\n');
    }).join('\n\n');
    sections.push(`${typeLabel[t]}\n${cards}`);
  });

  return `\n═══ Story Bible(世界书·不可违背事实) ═══\n下列事实是本故事的"canon",之后每一行台词、每一个动作都必须与它们相容。如果 Director plan 与 Bible 冲突,以 Bible 为准。\n\n${sections.join('\n\n')}\n═══════════════════════════════════════\n`;
}

// ─────────────────────────────────────────────────────────────────
// 3. Budget Plan — 按 scene 分配字数/情感温度
// ─────────────────────────────────────────────────────────────────

/**
 * 从场景列表 + 总镜头数,生成默认 Budget Plan。
 * 采用麦基的三幕 25%/50%/25% 黄金比例。
 */
export function buildDefaultSceneBudgets(
  scenes: Array<{ id: string }>,
  totalShots: number,
): SceneBudget[] {
  if (!scenes || scenes.length === 0) return [];

  const n = scenes.length;
  const act1End = Math.max(1, Math.floor(n * 0.25));
  const act2End = Math.max(act1End + 1, Math.floor(n * 0.75));

  // 情感曲线: 中→低→高→谷底→巅峰→余韵
  const emotionCurve = [0, -2, -4, -6, -3, +2, +5, +8, +10, -2];

  return scenes.map((s, i): SceneBudget => {
    const pos = i / Math.max(1, n - 1);
    const act: 1 | 2 | 3 = i < act1End ? 1 : i < act2End ? 2 : 3;

    const baseShots = Math.max(1, Math.round(totalShots / n));
    // Act 2 承担对抗,镜头数多 20%
    const shotCount = act === 2 ? Math.ceil(baseShots * 1.2) : baseShots;

    const weight = act === 1 ? 0.25 / act1End : act === 2 ? 0.5 / (act2End - act1End) : 0.25 / (n - act2End);

    // 情感温度曲线:用 pos 查表
    const tempIdx = Math.min(emotionCurve.length - 1, Math.floor(pos * emotionCurve.length));
    const emotionTemp = emotionCurve[tempIdx];

    let keyBeat: SceneBudget['keyBeat'];
    if (i === 0) keyBeat = 'hook';
    else if (i === act1End - 1) keyBeat = 'inciting-incident';
    else if (i === Math.floor(n * 0.5)) keyBeat = 'midpoint';
    else if (i === n - 2) keyBeat = 'climax';
    else if (i === n - 1) keyBeat = 'denouement';

    return { sceneId: s.id, weight, emotionTemp, shotCount, act, keyBeat };
  });
}

/**
 * 渲染 Budget Plan 块,供 Pass-1 planning prompt 注入。
 * LongWriter 的核心洞察: 让 LLM 同时规划"每段写多少、推到什么温度",
 * 能显著减少末尾崩塌。
 */
export function buildBudgetPlanBlock(budgets: SceneBudget[]): string {
  if (!budgets || budgets.length === 0) return '';

  const beatLabel = {
    hook: '[钩子]',
    'inciting-incident': '[激励事件]',
    midpoint: '[中点反转]',
    climax: '[高潮]',
    denouement: '[余韵]',
  };

  const rows = budgets.map((b) => {
    const beatTag = b.keyBeat ? ` ${beatLabel[b.keyBeat]}` : '';
    const tempArrow = b.emotionTemp > 3 ? '⬆' : b.emotionTemp < -3 ? '⬇' : '→';
    return `  · 场景${b.sceneId}: Act${b.act} | ${b.shotCount}镜 | 情感${tempArrow}${b.emotionTemp > 0 ? '+' : ''}${b.emotionTemp}${beatTag}`;
  }).join('\n');

  return `\n═══ 镜头预算(Budget Plan) ═══\n按下列预算分配镜头数与情感温度。超配/欠配都会导致节奏失衡。\n\n${rows}\n\n📐 总镜头数: ${budgets.reduce((sum, b) => sum + b.shotCount, 0)}\n📐 三幕结构: Act1=${budgets.filter((b) => b.act === 1).length}场 / Act2=${budgets.filter((b) => b.act === 2).length}场 / Act3=${budgets.filter((b) => b.act === 3).length}场\n═══════════════════════════\n`;
}

// ─────────────────────────────────────────────────────────────────
// 4. Critic Prompt — 麦基 11 维评分器
// ─────────────────────────────────────────────────────────────────

export function buildCriticSystemPrompt(): string {
  return `你是一位苛刻的剧本评审,精通罗伯特·麦基 (Robert McKee) 的《Story》方法论,并且按 Dramaturge 框架做迭代评分。

你的任务是对一份剧本草稿做一次"批评+修复方案"审稿,不是改写,只是定位问题并给出可执行的修复 action。

## 评分标准(0-10 每维,总分 × 10/11 归一化到 0-100)

1. **hook** — 第 1 镜是否是真正的钩子(悬念/闪回/极端反差/情感冲击),而不是"主角起床/走路/看风景"
2. **threeAct** — 三幕比例是否接近 25%/50%/25%,有无明显的结构畸形
3. **incitingIncident** — Act 1 末尾是否有不可逆的激励事件,把主角真的卷进去
4. **midpoint** — Act 2 中段是否有反转/代价揭示,还是平推到结尾
5. **climax** — 倒数第 2 镜是否给主角一个不可逆的选择,暴露真正的人物本质
6. **emotionCurve** — 情感温度是否真实起伏,理想曲线"中→低→高→谷底→巅峰→余韵",单调上升/下降 = 低分
7. **valueShift** — 每镜头开头/结尾的情感价值是否不同,"平静→平静"= 废镜头
8. **expectationGap** — 每镜头角色预期 ≠ 实际结果(推进故事的引擎)
9. **voice** — 各角色台词是否有辨识度,能不能"换个名字也能说"(可以 = 低分)
10. **pacing** — 节奏上是否有"无聊段",镜头分配是否合理
11. **consistency** — 是否违反 Story Bible / 角色外观 / 禁词红线

## 输出格式(严格 JSON,不要任何解释)

\`\`\`json
{
  "score": <0-100 整数>,
  "dimensions": {
    "hook": <0-10>,
    "threeAct": <0-10>,
    "incitingIncident": <0-10>,
    "midpoint": <0-10>,
    "climax": <0-10>,
    "emotionCurve": <0-10>,
    "valueShift": <0-10>,
    "expectationGap": <0-10>,
    "voice": <0-10>,
    "pacing": <0-10>,
    "consistency": <0-10>
  },
  "fixes": [
    "<最重要的修复 action 1,具体到镜头号和怎么改>",
    "<action 2>",
    "..."
  ],
  "keep": [
    "<这一版必须保留的亮点 1>",
    "..."
  ]
}
\`\`\`

关键约束:
- fixes 按重要性降序,最多 6 条,每条必须是"在第 N 镜,把 X 改成 Y"这种级别的具体,不要"加强冲突"这种空话
- keep 是给下一轮改写者的护身符,列出不能因改坏其他地方而失去的东西
- score 的目标:优秀 ≥ 85,合格 70-84,需重写 < 70`;
}

/**
 * 构造 critic 的 user prompt,带上剧本草稿 + 可选的 Story Bible 作为参考。
 */
export function buildCriticUserPrompt(
  draft: { title?: string; scenes: any[]; shots: any[] },
  storyBible?: string,
): string {
  return `请审阅以下剧本草稿:

## 剧本基本信息
标题: ${draft.title || '未命名'}
场景数: ${draft.scenes?.length || 0}
镜头数: ${draft.shots?.length || 0}

## 草稿 JSON
\`\`\`json
${JSON.stringify({ title: draft.title, scenes: draft.scenes, shots: draft.shots }, null, 2).slice(0, 8000)}
\`\`\`
${storyBible ? `\n## 参考 Story Bible\n${storyBible}` : ''}

按评分标准给出 JSON 评审结果。`;
}

// ─────────────────────────────────────────────────────────────────
// 5. Critic-Rewrite Loop Driver
// ─────────────────────────────────────────────────────────────────

export interface CriticRewriteOptions {
  /** 目标分数,达到就停止 */
  targetScore?: number;
  /** 最大轮次 */
  maxRounds?: number;
  /** 解析 critic 返回的 JSON 的 robust parser */
  parseCritic?: (raw: string) => CriticFeedback | null;
}

/**
 * 从 critic 的原始返回里抽 JSON。
 * 兼容 ```json 代码块 / 纯 JSON / 前后有多余文字 的情况。
 */
export function parseCriticFeedback(raw: string): CriticFeedback | null {
  if (!raw) return null;

  // 1. 尝试提取 ```json 块
  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  const body = codeBlock ? codeBlock[1] : raw;

  // 2. 找到第一个 { 和最后一个 }
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (typeof parsed.score !== 'number' || !parsed.dimensions) return null;
    return parsed as CriticFeedback;
  } catch {
    return null;
  }
}

/**
 * 构造"改写 prompt"——把 critic 的 fixes 作为指令,要求 writer 只改这些点。
 * Dramaturge 的核心技巧: 不让 writer 从头重写,只在已有 draft 基础上 patch 指定位置。
 */
export function buildRewritePrompt(feedback: CriticFeedback, previousDraft: any): string {
  const fixes = feedback.fixes.map((f, i) => `  ${i + 1}. ${f}`).join('\n');
  const keeps = feedback.keep.map((k, i) => `  ${i + 1}. ${k}`).join('\n');

  return `你刚刚写完的剧本草稿得到了评审意见。请基于原草稿做 **有针对性的修改**,不要全部重写。

## 上一版评分
总分: ${feedback.score}/100
${Object.entries(feedback.dimensions).map(([k, v]) => `  · ${k}: ${v}/10`).join('\n')}

## 必须修复的点(按重要性)
${fixes}

## 必须保留的亮点(改其他地方时不能改丢)
${keeps || '  (无)'}

## 上一版草稿
\`\`\`json
${JSON.stringify(previousDraft, null, 2).slice(0, 6000)}
\`\`\`

严格要求:
- 只改 fixes 指出的具体镜头 / 字段,其他部分保持不变
- keep 列表里的元素必须原样保留
- 输出格式与上一版完全一致(JSON, 同一 schema)
- 不要输出评论,直接给新版 JSON`;
}

/**
 * Critic-Rewrite Loop 调度器。
 * 给定一个 writer(能根据 prompt 生成 JSON 草稿) 和 critic(能对草稿打分),
 * 跑最多 maxRounds 轮"评分 → 修改"循环,直到达到 targetScore。
 *
 * 注意: 本函数不直接调用 LLM,由调用方传入两个闭包。这样上层可以复用
 * 任何 LLM(Claude / OpenAI / XVerse / 本地 Ollama) 而不锁死。
 */
export async function runCriticRewriteLoop<TDraft>(params: {
  initialDraft: TDraft;
  critic: (draft: TDraft) => Promise<CriticFeedback | null>;
  rewriter: (draft: TDraft, feedback: CriticFeedback) => Promise<TDraft>;
  opts?: CriticRewriteOptions;
  onRound?: (round: number, score: number, feedback: CriticFeedback) => void;
}): Promise<{ finalDraft: TDraft; rounds: number; finalScore: number; history: CriticFeedback[] }> {
  const targetScore = params.opts?.targetScore ?? 85;
  const maxRounds = params.opts?.maxRounds ?? 2;

  let draft = params.initialDraft;
  const history: CriticFeedback[] = [];
  let finalScore = 0;

  for (let round = 1; round <= maxRounds; round++) {
    const feedback = await params.critic(draft);
    if (!feedback) {
      // Critic 失败就停,保留当前 draft
      break;
    }
    history.push(feedback);
    finalScore = feedback.score;
    params.onRound?.(round, feedback.score, feedback);

    if (feedback.score >= targetScore) {
      return { finalDraft: draft, rounds: round, finalScore, history };
    }

    // 还没达标,让 rewriter 基于 feedback 改一版
    try {
      draft = await params.rewriter(draft, feedback);
    } catch {
      // 改写失败就停,保留当前 draft
      break;
    }
  }

  return { finalDraft: draft, rounds: history.length, finalScore, history };
}

// ─────────────────────────────────────────────────────────────────
// 对外统一入口:一键生成增强 block
// ─────────────────────────────────────────────────────────────────

export interface ScreenwriterEnhanceBundle {
  voices?: VoiceFingerprint[];
  bible?: StoryBibleEntry[];
  budgets?: SceneBudget[];
}

/**
 * 把上面三个 block 拼成一整段 userContext 增强文本。
 * 上层只需在构造 writer prompt 时,把这段追加到 userContext 末尾即可。
 */
export function buildScreenwriterEnhanceUserBlock(bundle: ScreenwriterEnhanceBundle): string {
  const parts: string[] = [];
  if (bundle.bible?.length) parts.push(buildStoryBibleBlock(bundle.bible));
  if (bundle.voices?.length) parts.push(buildVoiceFingerprintBlock(bundle.voices));
  if (bundle.budgets?.length) parts.push(buildBudgetPlanBlock(bundle.budgets));
  return parts.join('\n');
}
