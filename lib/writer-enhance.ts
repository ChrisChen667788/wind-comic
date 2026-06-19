/**
 * Writer enhancement primitives — cinematic writing on top of McKee
 *
 * 背景 (2026-04):
 *   大多数 AI 编剧 agent 只写"故事+对白",把摄影机语言甩给后面的分镜
 *   stage,结果 Writer 输出的 visualPrompt 都是"A woman walks in a forest"
 *   这种抽象描写,视频模型只能按通用模板生成 → 镜头平。
 *
 *   行业头部做法 (Sora 2 cinematic brief / Veo 3 官方 prompting guide /
 *   Runway Alpha Turbo):编剧阶段就把 cinematography 写死进每个 shot,
 *   让视频模型从"选构图"变成"还原已锁定的构图"。
 *
 *   我们借鉴 director-enhance 的 8 维 ShotBench + Veo 3 prose 模板,在
 *   Writer 层提供一套平行的 schema,让 Writer 的 visualPrompt 从一开始就
 *   符合 Veo 3 的 "[Camera move + lens]: [Subject] [Action], in [Setting],
 *   lit by [Light]" 模板,不需要 Storyboard stage 二次翻译。
 *
 * 这套原语和 director-enhance 的 8 维是共享枚举表的——Director 和 Writer
 * 都是摄影语言的"作者",区别只在 Writer 必须同时写故事,Director 可以不写。
 */

// ─────────────────────────────────────────────────────────────────
// Writer 的镜头级摄影 schema — 与 director-enhance 共享枚举
// ─────────────────────────────────────────────────────────────────

/**
 * Writer 的每个 shot 必带的 cinematography 字段。
 * 取值范围与 director-enhance.ts ShotSpec 完全一致 — 两者用同一套电影语言。
 */
export interface WriterShotCinema {
  /** 景别: ECU/CU/MCU/MS/MLS/LS/ELS/wide/insert */
  shotSize: string;
  /** 焦段: 16mm/24mm/35mm/50mm/85mm/135mm/200mm */
  lens: string;
  /** 机位角度: eye-level/low-angle/high-angle/birds-eye/worms-eye/dutch */
  cameraAngle: string;
  /** 相机运动(Runway 20 个标准动词之一) */
  cameraMovement: string;
  /** 光影意图: high-key/low-key/rim/silhouette/chiaroscuro 等 */
  lightingIntent: string;
  /** 构图法: rule-of-thirds/centered/leading-lines/negative-space 等 */
  composition: string;
  /** 与前一镜头的剪辑语法 */
  editPattern: string;
  /** 一句话说清 "为什么这么拍" — Sora 2 模式 */
  whyThisChoice: string;
}

// ─────────────────────────────────────────────────────────────────
// Writer Cinema Prompt Block — 注入到 getMcKeeWriterPrompt 末尾
// ─────────────────────────────────────────────────────────────────

/**
 * 编剧层的"电影语言"强化块。和 director-enhance 的 block 互补:
 *   - Director block 负责"设计整体视听风格 + 关键戏机位覆盖"
 *   - Writer block 负责"每个 shot 具体 lens / movement / 理据"
 *
 * 追加到 getMcKeeWriterPrompt 末尾,让 Writer 的 shots[i] 输出多出 9 个字段
 * (shotSize, lens, cameraAngle, cameraMovement, lightingIntent, composition,
 * editPattern, whyThisChoice, + 重写后的 visualPrompt)。
 */
export function buildWriterCinemaPromptBlock(): string {
  return `

## ═══ 第七铁律:视听语言必须在编剧层就锁死(不交给分镜阶段兜底)═══

**核心原则**: 编剧不是只写"发生了什么"，还要写"观众是怎么看到的"。
你写的每个 shot 都是一张镜头草图,包含焦段、机位、运动、光影、剪辑点。

**为什么重要**: 视频模型(Veo 3 / Sora 2 / Runway Gen-4)对提示词里的
"camera move + lens"这两个 token 注意力最集中。如果你只写"a woman walks",
模型会用默认 35mm 中景,每个镜头都一个样。如果你写"push-in on 85mm,
MCU single, low-angle: a woman slowly turns",模型才会真正按你想要的视听
语言生成。

### 每个 shot 必须追加输出的 9 个字段

\`\`\`json
{
  "shotSize":       "ECU | CU | MCU | MS | MLS | LS | ELS | wide | insert",
  "lens":           "16mm | 24mm | 35mm | 50mm | 85mm | 135mm | 200mm",
  "cameraAngle":    "eye-level | low-angle | high-angle | birds-eye | worms-eye | dutch",
  "cameraMovement": "static | dolly-in | dolly-out | truck-left | truck-right | crane-up | crane-down | pedestal-up | pedestal-down | arc | orbit | pan-left | pan-right | tilt-up | tilt-down | zoom-in | zoom-out | handheld | push-in | pull-out",
  "lightingIntent": "high-key | low-key | natural | hard | soft | rim | silhouette | chiaroscuro",
  "composition":    "rule-of-thirds | centered | symmetrical | leading-lines | frame-within-frame | negative-space | golden-ratio | diagonal",
  "editPattern":    "shot-reverse-shot | 180-rule-preserved | eyeline-match | match-cut | cross-cutting | montage | long-take",
  "whyThisChoice":  "一句话,必须同时说清 (1) 技术选择 (2) 服务的戏剧目的 (3) 与相邻镜头的对位关系"
}
\`\`\`

### 焦段选择的戏剧含义(必须和情感温度匹配)

| 焦段 | 适用情绪 | 典型用法 |
|-----|---------|---------|
| 16mm | emotionTemperature ≤ -5 (紧张/扭曲/不安) | 角色心理崩塌、空间压迫 |
| 24mm | -4 ~ 0 (建立/环境感) | 场景 establishing、群像 |
| 35mm | 0 ~ +3 (写实/日常) | 对话、日常行为 |
| 50mm | -2 ~ +2 (中性/旁观) | 客观叙事、中性对话 |
| 85mm | abs(temp) ≥ 5 (强烈情感) | 关键特写、潜文本、情感高潮 |
| 135mm | +3 ~ +6 或偷窥感 | 旁观、距离感、监视 |
| 200mm | 极限压缩 | 极端情感、时间凝固 |

**强制要求**: 全片禁止所有 shot 都用 50mm。单调焦段 = 平镜头。至少要有
3 种不同焦段,匹配情感曲线起伏。

### 相机运动 = 情感运动(Runway Gen-4 词汇表)

| 运动 | 情感效果 | 何时用 |
|-----|---------|-------|
| static | 观察/冷静 | 权威宣言、重要信息 |
| dolly-in / push-in | 聚焦情绪、走入内心 | 情感递增、发现、顿悟 |
| dolly-out / pull-out | 揭示、疏离、尘埃落定 | 高潮后的余韵、真相揭示 |
| handheld | 临场/混乱/第一人称焦虑 | 动作、追逐、恐惧 |
| crane-up | 超然/史诗/终局 | 结尾上帝视角、场面展开 |
| crane-down | 下降到事件/介入 | 开场降入、戏剧进入 |
| arc / orbit | 仪式感/凝固时刻 | 关键抉择、对峙 |
| tilt-up/down | 引导视线垂直移动 | 从脚到脸、从面到天 |
| zoom-in/out | 强调/揭示,比 dolly 更突兀 | 惊恐、突然发现 |

**强制要求**: camera_movement 的值必须严格取自上述 20 个英文动词之一。
禁止写"sweeping / dramatic / beautiful movement" — 这些抽象词会被视频
模型忽略,画面会变回平默认。

### visualPrompt 必须按 Veo 3 官方模板重写

Veo 3 / Sora 2 / Runway Gen-4 的 prompt 最优格式:

> **[Camera move + lens]: [Subject + specific action with physics], in [Setting + atmosphere], lit by [Light source + mood]**

示例:
- ❌ 旧格式: "A lone warrior in armor stands on a bridge at dawn, mist floating, dramatic lighting"
- ✅ Veo 3 格式: "Slow dolly-in on 85mm lens, MCU single, low-angle: a lone warrior in obsidian-lacquered armor slowly unsheathes a curved blade, breath condensing in the cold air, on a mist-covered stone bridge at dawn, ethereal tense silence, lit by warm golden sunrise breaking through layered fog"

你的每个 shot 的 visualPrompt 必须用这个格式,60-120 英文单词,前 20 字必须
是 "[camera move] on [lens], [shot size] [framing], [angle]:" 形式。

### 音画节拍绑定(FilMaster 模式)

除了已有的 soundDesign,每个 shot 还要输出:

\`\`\`json
{
  "diegeticSound": "画面内声音(风声/脚步/刀鞘摩擦)",
  "scoreMood":     "配乐情绪(低弦忧郁/高频紧张/完全留白)",
  "rhythmicSync":  "on-beat | off-beat | free"
}
\`\`\`

没有声音的视频观众 3 秒就划走,这三项和画面同等重要。

### whyThisChoice 的评分标准(Sora 2 playbook)

每个 shot 的 whyThisChoice 至少要说清三件事:

1. **技术选择**: "85mm + push-in"
2. **戏剧目的**: "让观众不自觉贴近角色的内心震撼"
3. **对位关系**: "承接上一镜的 24mm 远景拉开的距离感,形成反差冲击"

一句话串起来,必须能让其他协作者(分镜师/摄影师/视频生成器)照着执行。
════════════════════════════════════════`;
}

// ─────────────────────────────────────────────────────────────────
// Veo 3 prose 模板渲染 — 把 Writer 的结构化字段压成 prompt 首句
// ─────────────────────────────────────────────────────────────────

/**
 * 给定一个 Writer shot 的结构化字段,渲染 Veo 3 prose 模板的首句前缀。
 * 用法: 在 runVideoProducer 或 Writer 后处理阶段把它拼到 visualPrompt 前头。
 *
 * 示例输出:
 *   "slow push in on 85mm lens, MCU single, low-angle, rule-of-thirds:"
 */
export function renderVeoProsePrefix(cinema: Partial<WriterShotCinema>, framing?: string): string {
  const parts: string[] = [];
  if (cinema.cameraMovement) parts.push(cinema.cameraMovement.replace(/-/g, ' '));
  if (cinema.lens) parts.push(`on ${cinema.lens} lens`);
  const move = parts.join(' ');

  const frameParts: string[] = [];
  if (cinema.shotSize) frameParts.push(cinema.shotSize);
  if (framing) frameParts.push(framing);
  if (cinema.cameraAngle) frameParts.push(`${cinema.cameraAngle.replace(/-/g, ' ')} angle`);
  if (cinema.composition) frameParts.push(cinema.composition.replace(/-/g, ' '));
  const frame = frameParts.join(', ');

  if (!move && !frame) return '';
  if (move && frame) return `${move}, ${frame}:`;
  return `${move || frame}:`;
}

/**
 * 给定一个 Writer shot,把它的结构化 cinematography 字段 merge 回完整的
 * Veo 3 prose prompt。如果 visualPrompt 已经符合模板就原样返回,否则加
 * prefix。
 */
export function applyCinemaToVisualPrompt(shot: any): string {
  const vp: string = shot.visualPrompt || '';
  // 已经以 "movement on Xmm lens" 开头就别重复加了
  const alreadyProse = /^\s*(slow |fast |quick |)\s*(static|dolly|push|pull|truck|crane|pedestal|arc|orbit|pan|tilt|zoom|handheld|pedestal)\b/i.test(vp);
  if (alreadyProse) return vp;

  const prefix = renderVeoProsePrefix(shot as WriterShotCinema);
  if (!prefix) return vp;
  return `${prefix} ${vp}`.trim();
}

// ─────────────────────────────────────────────────────────────────
// v12.6.0 逐秒 beat sheet → 引擎 prompt 合成
//
// Writer 现在为每个 shot 产出 beats[](2-4 个带时间码的动作段)。这里把 beats
// 合成成喂给视频引擎的最终 prompt。各引擎对「时序」的解析能力不同:
//   - kling3   : 保留 "Beat 0-2s:" 时间码前缀(Kling 时间轴可对齐)
//   - seedance2: 严格 3s 窗口 "0-3s:" 前缀
//   - veo31/hailuo23: 剥时间码,用 then/suddenly/as 散文时序词串联
// 相机运动单独声明(不混进 action,避免引擎把运镜词当画面内容)。
// ─────────────────────────────────────────────────────────────────

type BeatLike = {
  ts: string; startSec: number; endSec: number; action: string; camera: string;
  dialogue?: string; audio?: string;
  // v12.11.0 黄金模板字段(可选)
  characters?: string[]; scene?: string; mood?: string; microExpression?: string; speedRamp?: string;
};
type ShotWithBeats = Partial<WriterShotCinema> & {
  visualPrompt?: string; beats?: BeatLike[];
  targetEngine?: 'veo31' | 'kling3' | 'hailuo23' | 'seedance2';
  globalLighting?: string; negativePrompt?: string;
  mustShow?: string[];
};

export function synthesizeBeatsToEnginePrompt(shot: ShotWithBeats): string {
  const beats = shot.beats;
  if (!beats || beats.length === 0) return shot.visualPrompt ?? '';
  const engine = shot.targetEngine ?? 'kling3';

  // v12.11.0:微表情内联进该 beat 动作(落在具体时间码上的表情,引擎才能演)
  const beatText = (b: BeatLike) => (b.microExpression ? `${b.action} (${b.microExpression})` : b.action);

  // 1) action 串联(按引擎差异)
  let actionStr: string;
  if (engine === 'kling3') {
    actionStr = beats.map((b) => `Beat ${b.ts}: ${beatText(b)}${b.dialogue ? ` — ${b.dialogue}` : ''}`).join(' / ');
  } else if (engine === 'seedance2') {
    actionStr = beats.map((b) => `${b.ts}: ${beatText(b)}`).join('. ');
  } else {
    const connectors = ['', ' Then ', ' Suddenly ', ' As this happens, '];
    actionStr = beats.map((b, i) => `${i > 0 ? connectors[Math.min(i, connectors.length - 1)] : ''}${beatText(b)}`).join('');
  }

  // 2) 相机声明(主运镜 + 后续变化)
  const primaryCamera = beats[0]?.camera ?? '';
  const cameraShifts = beats.slice(1).filter((b, i) => b.camera && b.camera !== beats[i].camera).map((b) => b.camera);
  const cameraStr = cameraShifts.length > 0 ? `${primaryCamera}, then ${cameraShifts.join(', ')}` : primaryCamera;

  // 3) Veo3 模板前缀(复用现有)
  const veoPrefix = renderVeoProsePrefix(shot as WriterShotCinema);

  // 4) 环境/光影 + 5) 音频 cue + 6) 拼合
  const envStr = [shot.globalLighting, shot.lightingIntent].filter(Boolean).join(', ');
  const audioStr = beats.filter((b) => b.audio).map((b) => b.audio).join('; ');
  // v12.11.0:氛围(逐 beat 去重)/ 慢镜插针 / Must-Show 目标物
  const moodStr = [...new Set(beats.map((b) => b.mood).filter(Boolean))].join(' → ');
  const speedStr = beats.filter((b) => b.speedRamp).map((b) => `${b.ts} ${b.speedRamp}`).join('; ');
  const mustShowStr = shot.mustShow && shot.mustShow.length ? shot.mustShow.join(', ') : '';
  const parts = [
    veoPrefix,
    actionStr,
    cameraStr ? `Camera: ${cameraStr}` : '',
    moodStr ? `Mood: ${moodStr}` : '',
    envStr,
    audioStr ? `Audio: ${audioStr}` : '',
    speedStr ? `Timing: ${speedStr}` : '',
    mustShowStr ? `Must show: ${mustShowStr}` : '',
    shot.negativePrompt ? `Avoid: ${shot.negativePrompt}` : '',
  ].filter(Boolean);
  return parts.join('. ');
}

/** 向后兼容:有 beats 用合成结果,否则回退已有 visualPrompt。所有下游取镜头 prompt 走这里。 */
export function getEffectiveVisualPrompt(shot: ShotWithBeats): string {
  if (shot.beats && shot.beats.length > 0) return synthesizeBeatsToEnginePrompt(shot);
  return shot.visualPrompt ?? '';
}

/**
 * v12.6.0 逐秒 beat sheet 铁律块 —— 注入 getMcKeeWriterPrompt 末尾。
 * 让 Writer 把每个 shot 的「单段静态描写」改为「2-4 个带时间码的动作 beat」,
 * 这是改善视频引擎动作时序、连贯性的关键(实测:静态描写型产出运动差)。
 */
export function buildBeatSheetBlock(): string {
  return `

## ═══ 逐秒分镜铁律:每个 shot 必须输出 beats 数组(时间码 beat sheet)═══

把镜头从「一段静态画面描写」升级为「2-4 个 micro-beat 的状态机推进」。每个 beat 对应
2-5 秒、一个**具体物理动作**,beats 各段时长之和 = 该镜 duration。

**标准四段式拆解**(按需取 2-4 段):
1. beat[0] 起始态:主体+环境+情绪,动词用进行时(禁止 "stands calmly/看风景" 这类静态)
2. beat[1] 触发动作:最强动词 + 因果连接(猛然/骤然/suddenly + sending/causing)
3. beat[2] 物理反应:因果结果 + 物理细节(慢动作/碎裂/水花)
4. beat[3] 收尾/过渡(可选):结束态或衔接下一镜

**硬规则**:
- 相机运动写进 beat.camera 字段(景别,角度,运镜),**禁止混进 action**。
  ❌ action:"镜头推进,她走向门口"  ✅ action:"她向门口迈三步,脚步沉重" + camera:"MS, eye-level, dolly-in"
- 相邻 beat 的 camera 必须有景别或运镜**变化**(避免一镜到底的呆板)。
- 单镜 beats 不超过 4 条;动作超过 4 段必须拆成独立镜头(否则引擎 temporal collapse)。
- **第 1 镜 beat[0] 强制钩子**:beatFunction="hook"、景别 CU/ECU、emotionTemperature ≤ -5 或 ≥ +7,
  画面是直接冲突/强情感,**禁止走路/起床/看风景开场**。
- 有参考图(I2V)时,beat.action 只写「变化量(the delta)」,不重复参考图里的静态信息(服装/背景/光)。
- 末镜(cliffhanger)duration 3-5s,最后一个 beat 以悬念台词或动作收尾,不可陈述句结束。

**beatFunction 全集**:hook | setup | conflict | escalate | reverse | release | cliffhanger。
**镜头内 dialogue 仍写在 shot.dialogue;beat.dialogue 仅在该台词落在具体时间码上时填。**

## ═══ 黄金模板对齐(v12.11.0):逐 beat 标清「谁/在哪/什么氛围/什么表情/什么速度」═══

对标工业级分镜模板(OnlyShot 8段SOP / Seedance 2.0 逐秒时间轴 / 即梦挂载元素),
**每个 beat 在 action/camera/dialogue/audio 之外,按需再填这几项(都可选,但越全引擎演得越准)**:

\`\`\`json
{
  "characters": ["陆晚晚"],            // 本 beat 出场角色(用资产里的角色名,不要新造名字)→ 锁脸/锁服装的多参挂载靠它
  "scene": "锈蚀铁笼格斗台",            // 本 beat 所在场景(用资产里的场景名)
  "mood": "冷峻压迫",                  // 这一拍的氛围/情绪基调(2-6 字)
  "microExpression": "眼神微眯·假动作预判", // 微表情:某角色某刻的脸部细节(让引擎演出情绪,而非空洞动作)
  "speedRamp": "0.2x slow-mo on impact"  // 速度/慢镜:动作峰值/受击帧做慢镜;无特殊则留空(默认 1x)
}
\`\`\`

**镜头级再补两项(写在 shot 上,不在 beat 上)**:
- \`mustShow\`: string[] —— 本镜**必须出现**的关键目标物/动作(如 ["短刃停在喉结前1cm","橡胶垫水渍溅起"]),送引擎作硬性清单,防漏拍。
- \`transition\`: "cut" | "continuous" —— 与上一镜的衔接。**同一场景的连续动作**填 "continuous"(可链式衔接首尾帧),**换场/换时间**填 "cut"。默认 "cut"。

**填写纪律**:
- characters/scene **必须引用已有资产名**(角色表/场景表里的名字),不要凭空造名 —— 这是多参挂载锁一致性的键。
- microExpression 只在「情绪转折/关键反应」的 beat 填,不要每拍都填(滥用=噪声)。
- speedRamp 只在「动作峰值/受击/insert 特写」填;慢镜 beat 的 startSec/endSec 仍按真实银幕秒数算(0.2x 不改时长字段)。
- mood 串起来就是本镜的情绪曲线,应与 emotionTemperature 一致。

### 动作/打斗段的节奏铁律(劲爆度关键)

打斗/追逐/对决要「快、脆、硬」—— **节奏是劲爆度的头号变量**:
- **动作镜 duration 设计成 1.5–3s**(不要 5–8s)。一次「出拳/受击/格挡」就是一个独立短镜,
  连续动作拆成 3–5 个短镜快切,而非塞进一个长镜(长镜=慢动作 MV,泄气)。
- **冲击瞬间(受击/砸中/刃入)才上 \`speedRamp\`**(如 "0.25x slow-mo on impact, 6 frames"),
  且只占该 beat 末段;其余保持 1x。**禁止整镜慢放**(那会让打斗变拖沓)。
- 动作镜 \`camera\` 用强运镜(whip-pan / snap-zoom / handheld follow / dutch),景别在 CU↔MS 间快速跳变。
- 同场景连续动作必须标 \`transition:"continuous"\`(否则衔接断裂、也用不上真末帧续接);换招/换位才 "cut"。
- 每个动作镜的 \`mustShow\` 写清「这一拳/这一脚打中了哪里 + 受击反馈」(护甲凹陷/重心偏移/水渍溅起),
  让引擎必须演出「打到了」的物理反馈 —— 这是「拳拳到肉」的来源。
════════════════════════════════════════`;
}

// ─────────────────────────────────────────────────────────────────
// Writer 输出校验 — 软警告,不阻塞
// ─────────────────────────────────────────────────────────────────

export interface WriterCinemaValidation {
  passed: boolean;
  missingCount: number;
  issues: string[];
  lensDistribution: Record<string, number>;
  movementDistribution: Record<string, number>;
}

/**
 * 校验 Writer 输出的 shots 是否携带 cinematography 字段。
 * 返回 diagnostic 报告供 orchestrator 选择是否发起 self-fix 循环。
 */
export function validateWriterCinematography(script: any): WriterCinemaValidation {
  const shots = script?.shots || [];
  const issues: string[] = [];
  const lensDistribution: Record<string, number> = {};
  const movementDistribution: Record<string, number> = {};

  let missingCount = 0;
  const required: (keyof WriterShotCinema)[] = [
    'shotSize', 'lens', 'cameraAngle', 'cameraMovement', 'lightingIntent', 'composition', 'whyThisChoice',
  ];

  shots.forEach((shot: any, i: number) => {
    const shotNum = shot.shotNumber ?? i + 1;
    for (const field of required) {
      if (!shot[field] || String(shot[field]).trim() === '') {
        issues.push(`shot ${shotNum}: 缺少 ${field}`);
        missingCount++;
      }
    }
    if (shot.lens) lensDistribution[shot.lens] = (lensDistribution[shot.lens] || 0) + 1;
    if (shot.cameraMovement) movementDistribution[shot.cameraMovement] = (movementDistribution[shot.cameraMovement] || 0) + 1;
  });

  // 多样性检查
  const uniqueLenses = Object.keys(lensDistribution).length;
  const uniqueMoves = Object.keys(movementDistribution).length;
  if (shots.length >= 4 && uniqueLenses < 2) {
    issues.push(`全片仅 ${uniqueLenses} 种焦段(${Object.keys(lensDistribution).join(', ')}) — 单调,至少 3 种`);
  }
  if (shots.length >= 6 && uniqueMoves < 3) {
    issues.push(`全片仅 ${uniqueMoves} 种相机运动 — 节奏单调,至少 4 种`);
  }

  // 焦段-情感匹配检查 (弱校验,只采样抽检)
  shots.forEach((shot: any, i: number) => {
    const shotNum = shot.shotNumber ?? i + 1;
    const temp = shot.emotionTemperature;
    if (typeof temp !== 'number') return;
    // 高强度情感(|temp|>=6)应该用 85mm+ 焦段
    if (Math.abs(temp) >= 6 && shot.lens && !/85mm|135mm|200mm/.test(shot.lens)) {
      issues.push(`shot ${shotNum}: emotionTemperature=${temp} (强烈) 但 lens=${shot.lens} 过宽,建议 85mm+`);
    }
  });

  return {
    passed: missingCount === 0 && issues.length === 0,
    missingCount,
    issues,
    lensDistribution,
    movementDistribution,
  };
}

// ─────────────────────────────────────────────────────────────────
// Multi-reference bundle builder — 给 Video Producer 准备的"seedance
// 2.0 同款" 多参考图打包器
// ─────────────────────────────────────────────────────────────────

export interface MultiReferenceBundle {
  /** 该 shot 的 first_frame_image(通常是 storyboard img) */
  firstFrameUrl: string;
  /** 所有主体参考图(角色三视图 + 场景图,按出场顺序),给 Minimax S2V 的 subject_reference 用 */
  subjectImages: string[];
  /** 辅助参考图,给 Veo 3.1 ingredient-to-video / Runway 多图参考用 */
  referenceImages: string[];
  /** 风格锚点图(sref),可选 */
  styleImage?: string;
  /** 该 shot 的所有角色名(用于 S2V 的 subject_reference type 字段) */
  characterNames: string[];
  /** debug: 这个 bundle 是怎么来的 */
  composition: string;
}

/**
 * 为某个 shot 打包"多参考图统一 prompt"。
 *
 * 设计思路(对齐 Seedance 2.0 的 9-ref 思路,但受限于各引擎最大 4 ref):
 *   1. firstFrameUrl = 分镜渲染图(最高优先级,锁构图)
 *   2. subjectImages = 出场角色的三视图(1-2 张,锁面部/服装/体型)
 *   3. referenceImages = 场景概念图 + 次要角色图 + 风格样图(辅助上下文)
 *
 * 去重、过滤 data URI、限制每类最大数量,保证下游 API 不被非法 URL 拖挂。
 */
export function buildMultiReferenceBundle(opts: {
  storyboardImageUrl?: string;
  shotCharacterNames: string[];
  characterImageMap: Map<string, string>;
  sceneImageUrl?: string;
  styleReferenceUrl?: string;
  previousStoryboardUrl?: string;
  /** v2.9 P0 Cameo: 用户上传的主角脸参考图,必须锁在 subjectImages[0] —— 全片脸不漂移 */
  cameoReferenceUrl?: string;
  /** v2.9 P1 Keyframes: 前一 shot 的视频末帧,作为本 shot 的辅助参考(shot N+1 衔接 shot N) */
  previousShotLastFrameUrl?: string;
  /** v2.11 #3 智能插帧:全局风格锚点(选定 shot 的中间帧),挂在 refs 里抗链式漂移 */
  globalAnchorFrameUrl?: string;
  /** 每类最大张数 */
  maxSubjects?: number;
  maxExtraRefs?: number;
}): MultiReferenceBundle {
  const maxSubjects = opts.maxSubjects ?? 2;
  const maxExtras = opts.maxExtraRefs ?? 3;
  const isValidHttp = (u?: string) =>
    !!u && !u.startsWith('data:') && (u.startsWith('http') || u.startsWith('/api/serve-file'));

  // 1) First frame:优先 storyboard 渲染图
  const firstFrameUrl = isValidHttp(opts.storyboardImageUrl) ? opts.storyboardImageUrl! : '';

  // 2) Subject images:shot 中出场角色的三视图,按出场顺序
  const subjectImages: string[] = [];
  const usedChars: string[] = [];
  // v2.9 P0 Cameo: 主角脸参考图必须排在 subjectImages[0],保证每个 shot 都锁这张脸
  if (isValidHttp(opts.cameoReferenceUrl)) {
    subjectImages.push(opts.cameoReferenceUrl!);
    usedChars.push('__cameo_primary__');
  }
  for (const name of opts.shotCharacterNames) {
    const url = opts.characterImageMap.get(name);
    if (isValidHttp(url) && !subjectImages.includes(url!)) {
      subjectImages.push(url!);
      usedChars.push(name);
      if (subjectImages.length >= maxSubjects) break;
    }
  }

  // 3) Reference images:风格图 + 场景图 + 未出场的其他角色(次要参考)
  const referenceImages: string[] = [];
  if (isValidHttp(opts.sceneImageUrl) && !subjectImages.includes(opts.sceneImageUrl!)) {
    referenceImages.push(opts.sceneImageUrl!);
  }
  // v2.9 P1 Keyframes: 前一 shot 的末帧作为衔接锚点(比 prev storyboard 更强的连续性信号)
  if (isValidHttp(opts.previousShotLastFrameUrl)
    && opts.previousShotLastFrameUrl !== firstFrameUrl
    && !subjectImages.includes(opts.previousShotLastFrameUrl!)) {
    referenceImages.push(opts.previousShotLastFrameUrl!);
  }
  // v2.11 #3 智能插帧:全局风格锚点(放在 prev-last-frame 之后、storyboard 之前)
  // 去重:如果跟末帧相同就不重复塞(因为 shot 1 的末帧和中间帧可能就是同一帧)
  if (isValidHttp(opts.globalAnchorFrameUrl)
    && opts.globalAnchorFrameUrl !== firstFrameUrl
    && opts.globalAnchorFrameUrl !== opts.previousShotLastFrameUrl
    && !subjectImages.includes(opts.globalAnchorFrameUrl!)) {
    referenceImages.push(opts.globalAnchorFrameUrl!);
  }
  if (isValidHttp(opts.previousStoryboardUrl) && opts.previousStoryboardUrl !== firstFrameUrl) {
    referenceImages.push(opts.previousStoryboardUrl!);
  }
  // 如果 shot 没有明确出场角色,用 map 的第一个角色作为 fallback ref
  if (subjectImages.length === 0 && opts.characterImageMap.size > 0) {
    const fallback = Array.from(opts.characterImageMap.values()).find(isValidHttp);
    if (fallback) referenceImages.unshift(fallback);
  }
  // 截断到 maxExtras
  const extras = referenceImages.slice(0, maxExtras);

  const composition = [
    firstFrameUrl && `firstFrame=storyboard`,
    subjectImages.length && `subjects=${usedChars.join(',')}`,
    extras.length && `extras=${extras.length}`,
    opts.styleReferenceUrl && isValidHttp(opts.styleReferenceUrl) && `style=set`,
  ].filter(Boolean).join(' | ');

  return {
    firstFrameUrl,
    subjectImages,
    referenceImages: extras,
    styleImage: isValidHttp(opts.styleReferenceUrl) ? opts.styleReferenceUrl : undefined,
    characterNames: usedChars,
    composition,
  };
}

/**
 * 把 bundle 展平成单层 URL 列表,去重,给只接受一个 referenceImages 数组
 * 的引擎(如 Veo 3.1 unified 通道)用。
 */
export function flattenBundleToUrls(bundle: MultiReferenceBundle, max = 4): string[] {
  const all: string[] = [];
  if (bundle.firstFrameUrl) all.push(bundle.firstFrameUrl);
  all.push(...bundle.subjectImages, ...bundle.referenceImages);
  if (bundle.styleImage) all.push(bundle.styleImage);
  // 去重保序
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of all) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// 音乐的视觉锚点 — 把视觉情感翻译成 Music prompt 增强
// ─────────────────────────────────────────────────────────────────

/**
 * 从 script + storyboard 抽取视觉信号(color palette / lighting signature /
 * dominant emotion),拼成一个 music prompt 的增强块,让配乐和画面对位。
 *
 * Minimax 音乐不收图,但"画面风格"可以用文字重新描述给它。
 */
export function buildMusicVisualAnchor(params: {
  shots: Array<{ emotion?: string; emotionTemperature?: number; lightingIntent?: string; scoreMood?: string }>;
  sceneColorPalettes?: string[];
  genre: string;
}): string {
  const anchor: string[] = [];

  // 1) 情感主线
  const emotions = params.shots.map((s) => s.emotion).filter(Boolean) as string[];
  const emotionFreq: Record<string, number> = {};
  emotions.forEach((e) => { emotionFreq[e] = (emotionFreq[e] || 0) + 1; });
  const dominant = Object.entries(emotionFreq).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant) anchor.push(`dominant mood: ${dominant}`);

  // 2) 温度曲线(up/down/flat)
  const temps = params.shots.map((s) => s.emotionTemperature).filter((t): t is number => typeof t === 'number');
  if (temps.length >= 3) {
    const first = temps[0];
    const last = temps[temps.length - 1];
    const peak = Math.max(...temps);
    const trough = Math.min(...temps);
    const arc = last - first > 3 ? 'rising' : first - last > 3 ? 'falling' : peak - trough > 6 ? 'valley-then-peak' : 'balanced';
    anchor.push(`emotional arc: ${arc} (from ${first} to ${last}, peak ${peak}, trough ${trough})`);
  }

  // 3) 光影签名 → 声音调色
  const lightings = params.shots.map((s) => s.lightingIntent).filter(Boolean) as string[];
  if (lightings.some((l) => /low-key|silhouette|chiaroscuro/.test(l))) {
    anchor.push('visually dark-toned — prefer low cello drone, muted brass, sparse piano');
  } else if (lightings.some((l) => /high-key|soft/.test(l))) {
    anchor.push('visually bright-toned — prefer warm strings, airy woodwinds');
  } else if (lightings.some((l) => /rim|hard/.test(l))) {
    anchor.push('visually contrast — prefer sharp staccato, percussive hits');
  }

  // 4) 调色板 → 情感色彩
  if (params.sceneColorPalettes?.length) {
    const palette = params.sceneColorPalettes.slice(0, 3).join(' / ');
    anchor.push(`scene palettes: ${palette}`);
  }

  // 5) scoreMood 直接穿透(如果 Writer 写了)
  const scoreMoods = params.shots.map((s) => s.scoreMood).filter(Boolean) as string[];
  if (scoreMoods.length) {
    const distinct = [...new Set(scoreMoods)].slice(0, 3);
    anchor.push(`per-shot score cues: ${distinct.join(' | ')}`);
  }

  return anchor.length ? anchor.join('. ') : '';
}
