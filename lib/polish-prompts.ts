/**
 * 剧本润色 — Prompt 工程层 (v2.11 #5 Pro Mode 升级)
 *
 * 为什么独立成模块:
 *   route.ts 应该只负责鉴权 / 超时 / JSON 解析,
 *   prompt 本身才是这个功能的真正灵魂, 独立才能:
 *   - 被测试用 snapshot 锁死 (防止无声退化)
 *   - 被其他上游 (比如 Writer pre-polish hook) 复用
 *
 * 两档模式:
 *
 *   basic  → 轻量词句打磨, 不动结构, 不出诊断。
 *           给"原文已经挺好, 只是想换下语气"的场景, 快 + 便宜。
 *
 *   pro    → 影视行业级润色 + AIGC 管线就绪度改造。
 *           调创意模型 (creativeModel), 温度更低, 输出更大, 外加一份结构化
 *           "行业诊断" 给导演/编剧看。是整条管线的"写作质量 QA"。
 *
 * Pro 模式的精神支柱 (为什么这样写 prompt):
 *
 *   1. McKee《故事》+ Field《救猫咪 beat sheet》+ Linda Seger《Making a Good
 *      Script Great》 — 三幕结构、角色弧光、subtext 铁律。不是背术语, 是
 *      让模型在改稿时 *带着* 这些诊断视角去看。
 *
 *   2. AIGC 友好写作 —— 这是漫剧/短片独有的约束:
 *         · 所有情绪必须能画 (低头 / 拳头攥紧, 而非"心碎")
 *         · 所有光影必须能 prompt (正侧顶逆 + 硬光柔光 + 色温)
 *         · 主角每次出场都复述 identity 锚点, 否则 Sora Cameo / Seedance
 *           reference 会漂移 (项目 v2.9-v2.11 的一致性守护需要这个前置)
 *
 *   3. 漫剧短视频竖屏节奏 —— 前 3 秒 Hook, 每 15-30 秒一个转折, 爽点密度比
 *      长片高一档。文本层面必须有能抓住 swipe-stop 的视觉钩。
 *
 *   4. 管线就绪度 —— 润色产物不止"好看", 还要能直接被后面的 Director /
 *      Storyboard agent 消费。所以 pro 模式要求模型自己拆出角色视觉锚、
 *      场景光影表、跨镜一致性 cue, 变成结构化 JSON 而非一坨文字。
 */

export type PolishStyle =
  | 'literary' | 'commercial' | 'thriller' | 'comedy' | 'documentary' | 'poetic';
export type PolishIntensity = 'light' | 'moderate' | 'heavy';
export type PolishMode = 'basic' | 'pro';

export interface PolishPromptOptions {
  mode: PolishMode;
  style?: PolishStyle | string;
  intensity?: PolishIntensity | string;
  focus?: string;
}

export const STYLE_LABELS: Record<string, string> = {
  literary:    '文艺 (比喻细腻 / 意象丰富 / 留白)',
  commercial:  '商业 (节奏紧凑 / 爽点密集 / 对白口语化)',
  thriller:    '悬疑 (信息差铺设 / 氛围压抑 / 冷峻)',
  comedy:      '喜剧 (节奏错位 / 反差幽默 / 轻盈)',
  documentary: '纪实 (客观冷静 / 细节真实 / 克制)',
  poetic:      '诗意 (意境优先 / 韵律感 / 象征)',
};

export const INTENSITY_LABELS: Record<string, string> = {
  light:    '轻度 (只改词句, 不动结构)',
  moderate: '中度 (可调整语序 / 合并重复段落, 保留原意)',
  heavy:    '重度 (允许重写段落 / 加画面感 / 加潜台词, 骨架不变)',
};

/** 共用的 JSON 格式硬约束 —— 两档模式都要尾挂这段 */
const JSON_STRICTNESS = `
⚠ 非常重要的 JSON 格式约束(违反则整体失败):
- 所有字符串值里的换行必须用转义序列 \\n 表示, 严禁出现真实的换行符(0x0A)
- 字符串内的双引号一律写成 \\"
- 不要在 JSON 外加任何前后缀文字, 不要加 \`\`\`json 围栏
- 整个响应从第一个 { 开始, 到最后一个 } 结束, 之间严格合法 JSON`;

// ──────────────────────────────────────────
// Basic mode (原本就有, 保持不变)
// ──────────────────────────────────────────

function buildBasicPrompt(opt: PolishPromptOptions): string {
  const styleLine = opt.style && STYLE_LABELS[opt.style]
    ? `目标风格: ${STYLE_LABELS[opt.style]}`
    : '目标风格: 保持原风格,仅在可读性上优化';
  const intLine = INTENSITY_LABELS[opt.intensity || 'moderate'];
  const focusLine = opt.focus ? `\n特别要求: ${opt.focus}` : '';

  return `你是资深影视文学编辑, 擅长在不破坏故事骨架的前提下, 把文字从"可读"提升到"有画面感 / 有节奏 / 能留住观众"。

${styleLine}
润色力度: ${intLine}${focusLine}

铁律:
1. 不新增/删减故事情节, 不改角色名, 不改结局
2. 若原文是分镜格式(含 Shot 1 / 场景 / 对白等结构), 保留这些字段标签, 只润色文字内容
3. 对白口语化, 去除书面冗余("我认为"→"我觉得"), 但保留人物说话风格
4. 动作描写用强动词 + 具体感官细节 (视觉/听觉/触觉), 少用形容词堆砌
5. 删掉"他感到很伤心"这类直接情绪标注, 改成通过动作/景物映射情绪
6. 行数大致守恒(允许 ±20%)

严格返回如下 JSON(只输出 JSON, 不要 markdown 围栏):
{
  "polished": "<润色后的完整剧本, 保留换行>",
  "summary": "<50 字内说清主要改了什么>",
  "notes": ["<具体改动点 1, 20 字以内>", "<改动点 2>", "..."]
}
${JSON_STRICTNESS}`;
}

// ──────────────────────────────────────────
// Pro mode — 影视 / 漫剧 / AIGC 头部标准
// ──────────────────────────────────────────

function buildProPrompt(opt: PolishPromptOptions): string {
  const styleLine = opt.style && STYLE_LABELS[opt.style]
    ? `目标风格: ${STYLE_LABELS[opt.style]}`
    : '目标风格: 保持原风格,仅在质量和 AIGC 就绪度上全面升级';
  const intLine = INTENSITY_LABELS[opt.intensity || 'moderate'];
  const focusLine = opt.focus ? `\n创作者特别要求: ${opt.focus}` : '';

  return `你是资深影视/漫剧剧本医生 + AIGC 视频制片顾问。十五年 Netflix / A24 / 爱奇艺短剧的改稿经验, 同时深度参与 AI 漫剧管线 (Sora 2 Cameo / Seedance / Luma Ray 3)。
你会同时用三副眼睛读这个剧本:

① 编剧医生视角 — McKee《故事》 + Field《救猫咪 Save the Cat beat sheet》+ Linda Seger《Making a Good Script Great》
② 漫剧/短视频视角 — 竖屏 swipe-stop 爽点密度、前 3 秒 Hook、15-30 秒一个转折点
③ AIGC 制片视角 — 一切情绪必须能画, 一切光影必须能 prompt, 主角 identity 必须每场复述以防 Cameo 漂移

${styleLine}
润色力度: ${intLine}${focusLine}

【一、改写铁律 — 绝不违反】
A. 情节守恒: 不新增/删减故事节点, 不改角色名, 不改结局。你是"剧本医生"不是"重写师"。
B. 分镜标签守恒: 原文里的 "Shot N / 场景 / 对白 / 动作 / 镜头" 等结构标签必须原样保留, 只润色其后的文字。
C. 行数守恒: 全文字数控制在 ±25% 以内。

【二、改写方向 — 按此升级】
1. 对白反直抒 (anti on-the-nose): 删除"我恨你 / 我好伤心"这类直白情绪宣告, 改用 subtext —
   人物说 A, 潜台词是 B。参考《赛伦盖蒂》: "今天天气不错" 底下藏的是"我们分手吧"。
2. 情绪可视化: 所有"感到 / 心想 / 觉得"全部改写成可被视频模型画出的动作 / 景物 —
   "他很紧张" → "他摸向裤缝, 拇指一下一下搓着布料", "她心碎" → "她低头把玻璃杯一圈圈转, 看了很久才开口"。
3. 动作描写用强动词: 砸/攥/扯/碾/掀 优先于 放/碰/推。删"缓缓地""慢慢地"这类副词堆砌。
4. 三幕节拍就位: 确保能识别出 Inciting Incident (激励事件) / Midpoint (中点反转) /
   Climax (高潮) / Resolution (收尾)。如果原文某个关键 beat 模糊, 在润色时用一两句话把它点亮。
5. 每个场景 Late-Enter / Early-Exit: 晚进早出, 删掉"寒暄开场"和"交代式收尾"。场景从冲突刚起来开始, 从钩子刚丢下时结束。
6. Hook 放在前 3 秒: 第一幕开场必须有一个视觉冲突 / 信息差 / 反常识画面, 让竖屏刷到的人停下来。

【三、AIGC 管线铁律 (这是漫剧区别于长片的命门)】
AIGC 铁律-1 (角色锁脸): 主角每一次出场, 先用一两行描写 "identity 锚点" —
   发型 + 脸型 + 眼睛颜色 + 肤色 + 标志性服饰 / 道具。同一个角色多场戏要复述同一套锚点
   (这是 Sora 2 Cameo / Seedance 多参考图的前置, 没这个会跨镜漂脸)。
AIGC 铁律-2 (光影可 prompt): 每个场景开头一句话点明 光源方向 (正/侧/顶/逆) + 光质 (硬光/柔光) +
   色温 (暖黄/冷蓝/中性), 同一场戏的所有 shot 共享这组设定。
AIGC 铁律-3 (镜头衔接): 连续两场戏之间, 末尾动作/道具 = 下一场开头的视觉钩 —— 比如上一场
   "她把扳指放在桌上" 下一场开头就要 "扳指还在桌角, 阳光从东侧压进来"。这是 v2.10 keyframes
   首尾帧锁定的文本前置。
AIGC 铁律-4 (禁词规避): 避开会让视频模型概率性失败的描写 ——
   "字幕 / 水印 / logo / 二维码 / text overlay", 以及"无法被单帧捕捉的过程动作"("花了三年时间""渐渐老去")。
AIGC 铁律-5 (时长估算): 默认每句对白约 2-3 秒, 每个动作镜头 1.5-4 秒, 标上时长有助于后面 Storyboard
   精确计算总片长。

【四、同时输出一份行业诊断 (industry audit)】
作为剧本医生, 改完稿后你必须出一份体检单。严格诚实, 发现问题就标出, 不要凑好话。

【五、严格返回如下 JSON — 只输出 JSON, 不要 markdown 围栏】
{
  "polished": "<润色后的完整剧本, 保留所有原有结构标签, 换行用 \\n>",
  "summary": "<80 字内总结这轮主要改了什么, 和基础润色的差别在哪>",
  "notes": ["<具体改动点 1, 30 字内, 带出处>", "<改动点 2>", ...],
  "audit": {
    "hook": {
      "strength": "weak"|"ok"|"strong",
      "at3s": "<前 3 秒呈现什么视觉钩, 具体描述; 若弱给出补强建议>",
      "rationale": "<为什么给这个评级, 40 字内>"
    },
    "actStructure": {
      "incitingIncident": "<激励事件出现在哪, 一句话; 若缺失写 '未识别'>",
      "midpoint": "<中点反转, 一句话; 若缺失写 '未识别'>",
      "climax": "<高潮在哪; 若缺失写 '未识别'>",
      "resolution": "<收尾是否完整, 一句话>",
      "missingBeats": ["<Save the Cat 15 beats 中缺失的, 如 'Theme Stated 主题未点'>", ...]
    },
    "dialogueIssues": {
      "onTheNoseLines": ["<直抒胸臆的对白原文摘录, 最多 5 条>", ...],
      "abstractEmotionLines": ["<无法被画面呈现的抽象情绪描写摘录, 最多 5 条>", ...]
    },
    "characterAnchors": [
      {
        "name": "<角色名>",
        "visualLock": "<identity 锚: 发型+脸型+眼睛色+肤色+标志服饰/道具, 一句话>",
        "speechStyle": "<说话风格: 口头禅/句式/节奏, 一句话>",
        "arc": "<该角色的 want/need/flaw 一句话>"
      }
    ],
    "sceneLighting": [
      {
        "scene": "<场景简述>",
        "lightDirection": "<正/侧/顶/逆>",
        "quality": "<硬光/柔光/混合>",
        "colorTemp": "<暖黄/冷蓝/中性/具体色温值>",
        "mood": "<氛围: 压抑/明媚/悬疑/冷静等>"
      }
    ],
    "continuityAnchors": [
      "<跨镜一致性钩子, 每条说明上一场末尾 → 下一场开头的视觉/道具/动作衔接, 如 '第 3→4 场: 扳指在桌角 → 阳光压进来打在扳指上'>"
    ],
    "styleProfile": {
      "genre": "<主类型, 如 年代文艺短片 / 都市悬疑爽剧>",
      "tone": "<整体基调, 如 克制苍凉 / 高张力黑色>",
      "rhythm": "<节奏描述, 如 慢热铺垫 + 三幕骤升 / 高密度反转>",
      "artDirection": "<美术方向, 如 70 年代胶片质感 + 冷蓝夜景>"
    },
    "aigcReadiness": {
      "score": 0-100,
      "reasoning": "<为什么给这个分, 主要就绪点和不就绪点, 80 字内>"
    },
    "issues": [
      {
        "severity": "minor"|"major"|"critical",
        "category": "pacing"|"dialogue"|"structure"|"character"|"aigc"|"other",
        "text": "<具体问题描述>",
        "where": "<出现在哪, 如 '第 2 场末尾' / '全片'>"
      }
    ]
  }
}
${JSON_STRICTNESS}`;
}

export function buildPolishPrompt(opt: PolishPromptOptions): string {
  return opt.mode === 'pro' ? buildProPrompt(opt) : buildBasicPrompt(opt);
}

/**
 * Pro 模式下给上层 UI 用的"就绪度等级"映射, 把 0-100 的数映射成可视化档位。
 * 这不是模型决定的, 是产品侧的阈值划分。
 */
export function readinessLevel(score: number): {
  level: 'red' | 'amber' | 'green';
  label: string;
} {
  if (score >= 85) return { level: 'green', label: '管线就绪 · 可直接进 Director' };
  if (score >= 65) return { level: 'amber', label: '基本就绪 · 建议再过一遍' };
  return { level: 'red', label: '就绪度不足 · 建议先做一版重度润色' };
}
