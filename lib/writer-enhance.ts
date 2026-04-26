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
