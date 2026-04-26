/**
 * Director enhancement primitives — professional cinematography in prompts
 *
 * 背景调研 (2026-04):
 *   - Veo 3 / 3.1 官方 prompting guide: camera-move + lens 是生成器注意力
 *     最集中的两个 token,固化"[Camera move + lens]: [Subject] [Action +
 *     physics], in [Setting], lit by [Light source]"作为模板
 *   - Runway Gen-3 / Gen-4 相机控制语法: 10 个标准动词 (static / dolly /
 *     truck / crane / pedestal / arc / pan / tilt / zoom / handheld),
 *     非标动词会被忽略
 *   - Sora 2 cinematic brief: 每镜头必带 why_this_choice 理据
 *   - LTX Studio: shot ladder = establishing → master → OTS → CU → insert
 *   - FilmAgent (arXiv:2501.12909): Director-Cinematographer 的 Critique-
 *     Correct-Verify 循环基于这个 coverage ladder
 *   - FilMaster (arXiv:2506.18899): 440K 电影片段 RAG, 7 种经典剪辑语法
 *     (shot-reverse-shot / 180-rule / eyeline-match / match-cut /
 *     cross-cutting / montage / long-take)
 *   - ShotBench (arXiv:2506.21356): 8 维专家级镜头分类
 *     (shot_size / shot_framing / camera_angle / lens / lighting_type /
 *     lighting_condition / composition / camera_movement)
 *
 * 我们的产出:
 *   1. ShotSpec 8 维结构 (ShotBench) — 强类型化镜头规格
 *   2. Veo 3 master template — 语言层的输出模板
 *   3. 镜头焦段词汇表 + 情绪映射 — 消除 "为什么每个镜头都平"
 *   4. 相机运动 10 动词枚举 — 避免非标动词被生成器忽略
 *   5. 经典 coverage ladder — 对关键戏做完整机位覆盖
 *   6. 7 种剪辑语法标签 — 每个场景切换必带
 *   7. 每镜头音效/配乐/节拍绑定 — FilMaster 式音画对位
 *   8. why_this_choice 理据 — 让 LLM 说明每个技术选择
 *
 * 这些原语是 prompt 层的,不需要训练模型。上层可以一次性注入到导演 system
 * prompt 里,也可以按需(比如只要 8 维 schema 或只要 Veo 模板)部分使用。
 */

// ─────────────────────────────────────────────────────────────────
// 1. ShotBench 8 维镜头规格
// ─────────────────────────────────────────────────────────────────

export type ShotSize =
  | 'ECU'   // extreme close-up — 眼睛/手/物件特写
  | 'CU'    // close-up — 头肩
  | 'MCU'   // medium close-up — 胸部以上
  | 'MS'    // medium shot — 腰部以上
  | 'MLS'   // medium long shot — 膝盖以上
  | 'LS'    // long shot — 全身
  | 'ELS'   // extreme long shot — 人物渺小,环境主导
  | 'wide'  // 建立镜头 / 全景
  | 'insert';  // 插入镜头 / 细节特写

export type ShotFraming =
  | 'single'    // 单人
  | 'two-shot'  // 双人同框
  | 'three-shot'
  | 'group'
  | 'OTS-A'     // 从 A 的肩膀后看 B (over-the-shoulder A)
  | 'OTS-B'     // 从 B 的肩膀后看 A
  | 'POV'       // 第一人称主观镜头
  | 'reaction'; // 反应镜头

export type CameraAngle =
  | 'eye-level'
  | 'low-angle'       // 仰拍 — 赋予对象权威/威胁感
  | 'high-angle'      // 俯拍 — 削弱/脆弱感
  | 'birds-eye'       // 垂直俯视 — 上帝视角
  | 'worms-eye'       // 垂直仰视
  | 'dutch'           // 斜角 / 荷兰角 — 失衡/不安
  | 'canted';

export type LensFocal =
  | '16mm'  // 超广角 — 空间放大 / 扭曲 / 紧张
  | '24mm'  // 广角 — 建立镜头 / 环境感
  | '35mm'  // 自然 — 日常/写实
  | '50mm'  // 标准 — 接近人眼
  | '85mm'  // 中长焦 — 亲密 / 压缩 / 浅景深
  | '135mm' // 长焦 — 旁观 / 压缩 / 远距离
  | '200mm'; // 超长焦 — 狙击 / 偷窥

export type LightingType =
  | 'natural-sun'
  | 'golden-hour'
  | 'blue-hour'
  | 'overcast'
  | 'moonlight'
  | 'practical'     // 画面内光源(烛火/台灯)
  | 'tungsten'
  | 'neon'
  | 'mixed';

export type LightingCondition =
  | 'high-key'   // 亮调, 低对比 — 喜剧/梦境
  | 'low-key'    // 暗调, 高对比 — noir / 惊悚
  | 'natural'
  | 'hard'       // 硬光 — 锐利阴影
  | 'soft'       // 柔光 — 扩散
  | 'rim'        // 轮廓光
  | 'silhouette'
  | 'chiaroscuro'; // 明暗对比

export type Composition =
  | 'rule-of-thirds'
  | 'centered'
  | 'symmetrical'
  | 'leading-lines'
  | 'frame-within-frame'
  | 'negative-space'
  | 'golden-ratio'
  | 'diagonal';

// Runway Gen-3 标准动词表(非此列的动词会被生成器忽略)
export type CameraMovement =
  | 'static'          // 固定
  | 'dolly-in'        // 推轨 — 聚焦情绪
  | 'dolly-out'       // 拉轨 — 揭示 / 疏离
  | 'truck-left'      // 横移左
  | 'truck-right'
  | 'crane-up'        // 升镜
  | 'crane-down'
  | 'pedestal-up'     // 垂直升(固定焦距)
  | 'pedestal-down'
  | 'arc'             // 弧形围绕
  | 'orbit'           // 360 环绕
  | 'pan-left'
  | 'pan-right'
  | 'tilt-up'
  | 'tilt-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'handheld'        // 手持 — 临场感
  | 'push-in'         // 等同 dolly-in(生成器常用别名)
  | 'pull-out';

export interface ShotSpec {
  shot_size: ShotSize;
  shot_framing: ShotFraming;
  camera_angle: CameraAngle;
  lens: LensFocal;
  lighting_type: LightingType;
  lighting_condition: LightingCondition;
  composition: Composition;
  camera_movement: CameraMovement;
  /** 持续时间(秒) — 为制片人的 runtime budget validator 用 */
  duration_s?: number;
  /** 该镜头关联的剪辑语法(只有在切换处需要填) */
  edit_pattern?: EditPattern;
}

// ─────────────────────────────────────────────────────────────────
// 2. 7 种经典剪辑语法(场景切换时带上)— FilMaster
// ─────────────────────────────────────────────────────────────────

export type EditPattern =
  | 'shot-reverse-shot'  // 正反打 — 对话
  | '180-rule-preserved' // 保持轴线 — 空间连续性
  | 'eyeline-match'      // 视线匹配 — 角色在看什么
  | 'match-cut'          // 匹配剪辑 — 形状/动作相似
  | 'cross-cutting'      // 交叉剪辑 — 两线平行
  | 'montage'            // 蒙太奇 — 时间压缩
  | 'long-take';         // 长镜头 — 沉浸

// ─────────────────────────────────────────────────────────────────
// 3. 焦段 ↔ 情绪映射表(给 LLM 做查表参考)
// ─────────────────────────────────────────────────────────────────

export const LENS_EMOTION_MAP: Record<LensFocal, string> = {
  '16mm': '紧张 / 扭曲 / 空间压迫 / 不安',
  '24mm': '建立 / 环境感 / 写实',
  '35mm': '自然 / 日常 / 生活感',
  '50mm': '中性 / 旁观 / 接近人眼',
  '85mm': '亲密 / 情感压缩 / 浅景深聚焦',
  '135mm': '偷窥 / 旁观 / 距离感',
  '200mm': '狙击 / 监视 / 极度压缩',
};

export const MOVEMENT_EMOTION_MAP: Partial<Record<CameraMovement, string>> = {
  'static': '观察 / 稳定 / 冷静',
  'dolly-in': '聚焦情绪 / 走入角色内心 / 紧张递增',
  'dolly-out': '揭示 / 疏离 / 尘埃落定',
  'handheld': '临场 / 混乱 / 第一人称焦虑',
  'crane-up': '超然 / 史诗 / 终局',
  'crane-down': '下降到事件 / 介入',
  'orbit': '全景揭示 / 时空凝固',
  'zoom-in': '强调 / 发现 / 心理特写',
  'zoom-out': '揭示更大的真相 / 超越',
};

// ─────────────────────────────────────────────────────────────────
// 4. Veo 3 主模板 — 镜头散文输出格式
// ─────────────────────────────────────────────────────────────────

/**
 * Veo 3 canonical prose template:
 *   [Camera move + lens]: [Subject] [Action &amp; physics], in [Setting + atmosphere], lit by [Light source]
 *
 * 此函数把结构化 ShotSpec + 内容字段 渲染为这一格式的英文 prose prompt,
 * 可直接喂给 Veo 3.1 / Sora 2 / Runway Gen-4 等主流视频生成器。
 */
export function renderVeoPromptFromShotSpec(spec: ShotSpec, content: {
  subject: string;   // e.g. "a lone warrior in obsidian armor"
  action: string;    // e.g. "slowly unsheathes a curved blade"
  setting: string;   // e.g. "a mist-covered stone bridge at dawn"
  atmosphere?: string; // e.g. "ethereal, tense silence"
  light?: string;    // e.g. "warm golden sunrise breaking through fog"
}): string {
  const moveAndLens = `${spec.camera_movement.replace(/-/g, ' ')} on a ${spec.lens} lens`;
  const framing = `${spec.shot_size} ${spec.shot_framing}, ${spec.camera_angle} angle, ${spec.composition}`;
  const lightDesc = content.light
    ? content.light
    : `${spec.lighting_condition.replace(/-/g, ' ')} ${spec.lighting_type.replace(/-/g, ' ')} lighting`;
  const atmo = content.atmosphere ? `, ${content.atmosphere}` : '';
  return `${moveAndLens}, ${framing}: ${content.subject} ${content.action}, in ${content.setting}${atmo}, lit by ${lightDesc}`;
}

// ─────────────────────────────────────────────────────────────────
// 5. 经典 Coverage Ladder — 关键戏的完整机位覆盖
// ─────────────────────────────────────────────────────────────────

/**
 * 对一场对话/冲突戏,生成标准 6-7 机位覆盖推荐。
 * 给 Director 作为"你至少要想到这些机位"的 checklist。
 */
export function buildCoverageLadder(sceneType: 'dialogue' | 'action' | 'reveal' | 'montage' | 'establishing'): string[] {
  switch (sceneType) {
    case 'dialogue':
      return [
        'establishing wide (LS/ELS, 24mm, static) — 建立空间',
        'master 2-shot (MS, 35mm, static/slight-dolly) — 双人关系',
        'OTS-A (MCU, 50mm, static) — 从 A 后面看 B 说话',
        'OTS-B (MCU, 50mm, static) — 从 B 后面看 A 回应',
        'CU-A (85mm, slow dolly-in) — 关键情绪/潜文本',
        'CU-B (85mm, slow dolly-in) — 对方反应',
        'insert (ECU, 100mm) — 信物/手/眼神等细节',
      ];
    case 'action':
      return [
        'establishing wide (ELS, 16-24mm, crane) — 场域',
        'master action (LS, 24mm, handheld/arc) — 动作全景',
        'medium follow (MS, 35mm, handheld) — 贴近角色',
        'CU impact (CU, 85mm, whip-pan) — 撞击 / 关键动作瞬间',
        'reaction (CU, 85mm, static) — 旁观者反应',
        'insert (ECU, 135mm) — 武器/伤口/物件',
      ];
    case 'reveal':
      return [
        'tight CU misleading (CU, 85mm, static) — 让观众以为是 A',
        'pull-out to wide (ELS, 24mm, dolly-out) — 揭示真实环境',
        'reaction to reveal (CU, 85mm) — 角色的震惊/顿悟',
        'insert of clue (ECU, 100mm) — 让观众自己串起来的细节',
      ];
    case 'montage':
      return [
        'series of 4-8 short inserts (mixed CU/MCU, 50-85mm) — 时间压缩',
        'unified by music beat / color palette / action verb',
        'each shot ≤ 2s, total ≤ 15s',
      ];
    case 'establishing':
    default:
      return [
        'wide establishing (ELS, 16-24mm, slow crane-down or dolly-in) — 世界感',
        'atmospheric detail (insert, 85mm) — 标志性符号',
        'character entrance (MS→CU, 35→85mm, dolly-in) — 主角首次出现',
      ];
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. Shot Rationale — why_this_choice
// ─────────────────────────────────────────────────────────────────

export interface ShotRationale {
  /** 这个技术选择服务于什么戏剧目的 */
  dramaticIntent: string;
  /** 关联的麦基维度(hook/ii/midpoint/climax/valueShift 等) */
  mckeeDimension?: string;
  /** 一句话解释 */
  summary: string;
}

// ─────────────────────────────────────────────────────────────────
// 7. Director 增强 system prompt 块 — 注入到 McKee prompt 末尾
// ─────────────────────────────────────────────────────────────────

/**
 * 生成 Director 额外的专业 prompt 块,追加到现有 mckee-skill getDirectorSystemPrompt 末尾。
 * 这一块让 LLM 输出结构化 shotSpecs + coverage + editPatterns + why_this_choice。
 */
export function buildDirectorCinemaPromptBlock(): string {
  return `

## ═══ 专业摄影 / 剪辑 / 节奏 强化层(ShotBench + FilMaster + Veo 3 模板)═══

除了原有的角色 / 场景 / 情感 / 钩子字段,你还必须在每个关键 shot 上输出下列结构化字段。

### 每个 shot 必填的 8 维镜头规格(shotSpec)

\`\`\`json
{
  "shot_size":       "ECU | CU | MCU | MS | MLS | LS | ELS | wide | insert",
  "shot_framing":    "single | two-shot | three-shot | group | OTS-A | OTS-B | POV | reaction",
  "camera_angle":    "eye-level | low-angle | high-angle | birds-eye | worms-eye | dutch",
  "lens":            "16mm | 24mm | 35mm | 50mm | 85mm | 135mm | 200mm",
  "lighting_type":   "natural-sun | golden-hour | blue-hour | overcast | moonlight | practical | tungsten | neon | mixed",
  "lighting_condition": "high-key | low-key | natural | hard | soft | rim | silhouette | chiaroscuro",
  "composition":     "rule-of-thirds | centered | symmetrical | leading-lines | frame-within-frame | negative-space | golden-ratio | diagonal",
  "camera_movement": "static | dolly-in | dolly-out | truck-left | truck-right | crane-up | crane-down | pedestal-up | pedestal-down | arc | orbit | pan-left | pan-right | tilt-up | tilt-down | zoom-in | zoom-out | handheld | push-in | pull-out",
  "duration_s":      <1-8 秒的数字>,
  "edit_pattern":    "shot-reverse-shot | 180-rule-preserved | eyeline-match | match-cut | cross-cutting | montage | long-take"
}
\`\`\`

**强制要求**: camera_movement 的值必须严格取自上述 20 个英文动词之一(Runway/Veo/Sora 都是按这个词汇表识别,非标动词会被忽略,画面会变"平")。禁止写"sweeping / dramatic / cinematic movement"等抽象词。

### 焦段必须有戏剧目的(lens 选择指南)

| 焦段 | 情绪 / 用途 |
|-----|-----|
| 16mm | 紧张 / 扭曲 / 空间压迫 / 不安 |
| 24mm | 建立 / 环境感 / 写实 |
| 35mm | 自然 / 日常 / 生活感 |
| 50mm | 中性 / 旁观 / 接近人眼 |
| 85mm | 亲密 / 情感压缩 / 浅景深聚焦 |
| 135mm+ | 偷窥 / 旁观 / 距离感 / 狙击 |

**禁止整片都用 50mm**。必须根据情感温度和戏剧目的切换焦段,单调用镜就是平。

### 每个 shot 必填 why_this_choice(Sora 2 模式)

每个 shot 还要写一句话 why_this_choice,格式:

> "低角 24mm 因为这是主角的权力登场镜头 - 让观众从下往上看他,放大威压;与第 2 镜的俯拍形成权力反转。"

这句话必须同时说清: (1) 技术选择 (2) 服务的戏剧目的 (3) 与相邻镜头的对位关系。

### 场景切换必须标注剪辑语法(FilMaster 模式)

相邻 shot 之间必须采用 7 种经典剪辑语法之一,在后一个 shot 的 edit_pattern 字段声明:

- **shot-reverse-shot**: 对话正反打(两人对话的标准剪辑)
- **180-rule-preserved**: 空间轴线保持(关键)
- **eyeline-match**: A 看向画外 → 切到 A 看到的东西
- **match-cut**: 形状/动作/色彩匹配过渡(如圆盘→月亮)
- **cross-cutting**: 两条线平行剪辑(营造同时发生)
- **montage**: 蒙太奇(时间压缩,多个短镜头)
- **long-take**: 长镜头(一个 shot ≥ 15s,不切)

### 关键戏必须有机位覆盖(Coverage Ladder)

对**对话戏**,至少规划:
- establishing wide → master 2-shot → OTS-A → OTS-B → CU-A → CU-B → insert

对**动作戏**,至少规划:
- establishing wide → master action → medium follow → CU impact → reaction → insert

对**揭示戏**,至少规划:
- tight CU (误导) → pull-out to wide (揭示) → reaction → insert of clue

**禁止一个对话戏只给 1-2 个镜头**。至少 4 个,覆盖正反两个角色。

### 音效 / 配乐 / 节拍必须绑定到每个 shot

每个 shot 还要写:

\`\`\`json
{
  "diegetic_sound": "画面内声音(如:风声 + 刀鞘摩擦声)",
  "score_mood":     "配乐情绪(如:低弦忧郁 / 高频紧张 / 完全留白)",
  "rhythmic_sync":  "on-beat(剪辑跟节拍) | off-beat | free"
}
\`\`\`

这三项跟画面一样重要 — 没声音的短视频会"感觉空",观众 3 秒就划走。
════════════════════════════════════════`;
}

// ─────────────────────────────────────────────────────────────────
// 8. Director 输出校验 — 检查 shotSpecs 是否存在/字段完整
// ─────────────────────────────────────────────────────────────────

export function validateDirectorShotSpecs(plan: any): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  const shots = plan?.shots || plan?.shotSpecs || [];

  if (shots.length === 0) {
    return { passed: false, issues: ['plan 中没有 shots 或 shotSpecs 字段'] };
  }

  // 检查每个 shot 是否有 shotSpec 块
  shots.forEach((shot: any, i: number) => {
    const spec = shot.shotSpec || shot;
    if (!spec.camera_movement) issues.push(`shot ${i + 1}: 缺少 camera_movement`);
    if (!spec.lens) issues.push(`shot ${i + 1}: 缺少 lens`);
    if (!spec.shot_size) issues.push(`shot ${i + 1}: 缺少 shot_size`);
    if (!shot.why_this_choice) issues.push(`shot ${i + 1}: 缺少 why_this_choice 理据`);
  });

  // 检查焦段多样性(不能全是 50mm)
  const lenses = shots.map((s: any) => s.shotSpec?.lens || s.lens).filter(Boolean);
  const uniqueLenses = new Set(lenses);
  if (lenses.length > 4 && uniqueLenses.size === 1) {
    issues.push(`所有 ${lenses.length} 个 shot 都用同一焦段(${Array.from(uniqueLenses)[0]}) — 单调,必须至少 2 种`);
  }

  // 检查运动多样性
  const movements = shots.map((s: any) => s.shotSpec?.camera_movement || s.camera_movement).filter(Boolean);
  const uniqueMoves = new Set(movements);
  if (movements.length > 4 && uniqueMoves.size === 1) {
    issues.push(`所有 shot 都用同一机位运动 — 节奏单调`);
  }

  return { passed: issues.length === 0, issues };
}
