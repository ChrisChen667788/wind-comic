/**
 * lib/pull-sheet-replace (v11.1.2) — 拉片复刻的「替换 + 起片脚本」核心(阶段十九杀手锏)。
 *
 * 输入一张拉片表(出厂真值 / 外部 Vision / 骨架)+ 替换规则,产出:
 *   1. 替换后的逐镜字段(角色/场景/道具全可换 —— 文章实测「全员换猫」「名媛妆换素颜」)
 *   2. 逐镜复刻 prompt(原镜头描述 × 替换 → 渲染提示,**全开放可编辑**)
 *   3. 复刻起片脚本(ScriptShot,镜头语言 v2.8 字段回填 + 时长锁定)→ 灌回流水线
 *      的 Writer 注入位(skip 创意,保结构)并行生成新片。
 *
 * 替换引擎是**确定性多字段文本替换**(零 LLM 即可跑「全员换猫」);可选 LLM 把
 * 替换指令润色进 prompt(BYO,失败回退确定性)。本文件纯函数、零 IO、可单测。
 */
import type { PullSheet, PullSheetShot } from './pull-sheet';

export type ReplaceKind = 'global' | 'character' | 'scene' | 'prop';

export interface ReplaceRule {
  kind: ReplaceKind;
  /** 被替换的原词(global 必填;character/scene 可空 = 替换该维度全部) */
  from?: string;
  /** 替换成 */
  to: string;
  /** 可选参考图(角色库/Cameo/上传)— 复刻起片时作 cref/sref 一致性锚 */
  refImage?: string;
}

/** 受替换影响、参与 prompt 拼装的文本字段(声音/剪辑等不参与替换的不动) */
const TEXT_FIELDS: Array<keyof PullSheetShot> = [
  'description', 'scene', 'dialogue', 'composition', 'lightingIntent',
];

interface TextRule { from: string; to: string }

/**
 * 字面替换(确定性,无正则注入)。**已知局限**:中文无词边界,from='猫'
 * 会命中'熊猫' —— 故 derived 规则按 from 长度降序(长词先替换,缓解短词吃长词);
 * UI 提示填完整词条。characters 数组与所有文本字段共用同一组 derived 同序应用,
 * 保证字段间一致(审查修复:消除数组/文本两套规则的 desync)。
 */
function applyTextRules(text: string, rules: TextRule[]): string {
  if (!text) return text;
  let out = text;
  for (const r of rules) {
    if (!r.from || !r.to) continue;
    out = out.split(r.from).join(r.to);
  }
  return out;
}

/**
 * 为单镜把所有规则归一成统一文本替换序列(character/scene 的 empty-from 按本镜
 * 实际旧值派生具体 from→to;长词优先)。characters 数组与文本字段共用此序列。
 */
function deriveTextRules(shot: PullSheetShot, rules: ReplaceRule[]): TextRule[] {
  const derived: TextRule[] = [];
  for (const r of rules) {
    if (!r.to) continue;
    if (r.kind === 'character') {
      if (r.from) derived.push({ from: r.from, to: r.to });
      else for (const name of shot.characters) if (name) derived.push({ from: name, to: r.to });
    } else if (r.kind === 'scene') {
      if (r.from) derived.push({ from: r.from, to: r.to });
      else if (shot.scene) derived.push({ from: shot.scene, to: r.to });
    } else if (r.from) {
      derived.push({ from: r.from, to: r.to }); // global / prop
    }
  }
  // 长词优先 —— 缓解中文子串误伤(用户若加了「老板娘」规则,先于「老板」生效)
  return derived.sort((a, b) => b.from.length - a.from.length);
}

export interface ReplicaShot {
  shotNumber: number;
  durationSec: number;
  /** 替换后的叙事/镜头字段(用于回填 ScriptShot) */
  scene: string;
  characters: string[];
  dialogue: string;
  description: string;
  shotSize: string;
  composition: string;
  cameraMovement: string;
  lens: string;
  lightingIntent: string;
  /** 复刻渲染 prompt(可编辑;editedPrompts 覆盖此值) */
  prompt: string;
  /** 命中规则带来的参考图(去重) */
  refImages: string[];
}

/** 把一镜的替换后字段拼成渲染 prompt(镜头语言入 prompt 才能让复刻"照着拍")。 */
export function buildReplicaPrompt(s: {
  scene: string; characters: string[]; description: string;
  shotSize: string; composition: string; cameraMovement: string; lens: string; lightingIntent: string;
}): string {
  const parts: string[] = [];
  if (s.description) parts.push(s.description);
  if (s.characters.length) parts.push(`角色:${s.characters.join('、')}`);
  if (s.scene) parts.push(`场景:${s.scene}`);
  const cam = [s.shotSize, s.composition, s.cameraMovement, s.lens].filter(Boolean).join(',');
  if (cam) parts.push(`镜头:${cam}`);
  if (s.lightingIntent) parts.push(`光影:${s.lightingIntent}`);
  return parts.join('。');
}

/**
 * 应用替换规则 → 逐镜复刻数据(确定性)。
 * - global 规则:from→to 替换所有文本字段 + characters 数组项
 * - character 规则:from 命中的角色名换 to(from 空 = 整列每个角色都换 to);文本同步替换
 * - scene 规则:scene 字段换 to(from 空 = 全部场景统一换 to);文本同步替换
 * - prop 规则:当文本替换处理(from→to)
 */
export function applyReplacements(sheet: PullSheet, rules: ReplaceRule[]): ReplicaShot[] {
  return sheet.shots.map((shot) => {
    // 统一规则集 —— characters 数组与所有文本字段同序应用,保证字段间一致
    const derived = deriveTextRules(shot, rules);
    const replaced: Record<string, string> = {};
    for (const f of TEXT_FIELDS) replaced[f] = applyTextRules(String(shot[f] ?? ''), derived);
    const characters = Array.from(new Set(
      shot.characters.map((c) => applyTextRules(c, derived)).filter(Boolean),
    ));

    // 命中规则的参考图(去重)
    const refImages = Array.from(new Set(
      rules.filter((r) => r.refImage && matchedShot(shot, r)).map((r) => r.refImage!),
    ));

    const fields = {
      scene: replaced.scene,
      characters,
      dialogue: replaced.dialogue,
      description: replaced.description,
      shotSize: shot.shotSize,
      composition: replaced.composition,
      cameraMovement: shot.cameraMovement,
      lens: shot.lens,
      lightingIntent: replaced.lightingIntent,
    };
    return {
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      ...fields,
      prompt: buildReplicaPrompt(fields),
      refImages,
    };
  });
}

/** 规则是否作用于该镜(给参考图归集用):global/prop 看文本含 from;character/scene 看对应维度。 */
function matchedShot(shot: PullSheetShot, r: ReplaceRule): boolean {
  if (r.kind === 'character') return !r.from || shot.characters.includes(r.from);
  if (r.kind === 'scene') return !r.from || shot.scene === r.from;
  if (!r.from) return true;
  return TEXT_FIELDS.some((f) => String(shot[f] ?? '').includes(r.from!));
}

export interface ReplicaScript {
  title: string;
  synopsis: string;
  shots: any[]; // ScriptShot 形(create-pipeline Writer 注入位消费)
}

/**
 * 复刻起片脚本:ReplicaShot(可被 editedPrompts 覆盖 prompt)→ ScriptShot。
 * 镜头语言 v2.8 字段回填 + duration 锁定(复刻照原片节奏);prompt 进 visualPrompt。
 */
export function buildReplicaScript(
  title: string,
  shots: ReplicaShot[],
  opts?: { editedPrompts?: Record<number, string> },
): ReplicaScript {
  const edited = opts?.editedPrompts || {};
  return {
    title: title || '复刻片',
    synopsis: `基于拉片结构复刻:${shots.length} 镜`,
    shots: shots.map((s) => ({
      shotNumber: s.shotNumber,
      sceneDescription: s.scene || s.description,
      action: s.description,
      emotion: '',
      characters: s.characters,
      dialogue: s.dialogue,
      duration: s.durationSec,
      shotSize: s.shotSize,
      composition: s.composition,
      cameraMovement: s.cameraMovement,
      cameraWork: s.cameraMovement,
      lens: s.lens,
      lightingIntent: s.lightingIntent,
      visualPrompt: (edited[s.shotNumber] ?? s.prompt) || s.description,
    })),
  };
}

/** 全片参考图集合(复刻起片时作主体一致性锚)。 */
export function collectRefImages(shots: ReplicaShot[]): string[] {
  return Array.from(new Set(shots.flatMap((s) => s.refImages)));
}

/**
 * 合成 DirectorPlan(审查修复:复刻路径不让 Director 凭空想 plan —— 它只拿到
 * synopsis「基于拉片结构复刻」会回退占位角色「主角/伙伴」,导致 Character Designer
 * 渲染错主体)。直接从替换后的 shots 提炼真实角色/场景,跳过 Director。
 */
export function buildReplicaPlan(
  shots: Array<{ characters?: string[]; scene?: string }>,
  opts?: { genre?: string; style?: string },
): any {
  const charNames = Array.from(new Set(shots.flatMap((s) => s.characters || []))).filter(Boolean);
  const sceneNames = Array.from(new Set(shots.map((s) => s.scene || '').filter(Boolean)));
  return {
    genre: opts?.genre || '复刻',
    style: opts?.style || '',
    characters: charNames.map((name) => ({ name, description: name, appearance: name })),
    scenes: sceneNames.map((loc, i) => ({ id: `s${i + 1}`, description: loc, location: loc })),
    storyStructure: { acts: 1, totalShots: shots.length },
  };
}
