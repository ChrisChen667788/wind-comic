/**
 * lib/reference-elements (v9.4.3) — 多参考元素 (Multi-Reference Elements)。
 *
 * 对标可灵 3.0「Elements / 多图参考」(每张参考图是一个"元素":角色/道具/场景/风格,
 * 模型据此合成一致画面)。我们不照搬 —— 而是把每个元素按"角色"路由进既有一致性管线:
 *   - character → cref + 8 维 DNA 锁(`character-dna` / `cameo-vision`)
 *   - style     → sref / Style Bible(`style-bible`)
 *   - scene/prop→ 构图 / 环境上下文(注入分镜 prompt)
 *   - motion(视频)→ 运镜参考    ·   voice(音频)→ TTS 音色参考
 * 比可灵更深(我们有 DNA/cref/sref/Style Bible 整套一致性),且与 `multimodal-ref` 同源
 * (把它的自由文本 `role` 升级成结构化 `elementRole`,老载荷前向兼容)。
 *
 * 纯逻辑、client-safe、与具体引擎解耦。单测 tests/v9-4-3-reference-elements.test.ts。
 */
import type { ReferenceAsset } from './multimodal-ref';

export type ElementRole = 'character' | 'style' | 'scene' | 'prop' | 'motion' | 'voice';

export const ELEMENT_ROLE_LABEL: Record<ElementRole, string> = {
  character: '角色',
  style: '风格',
  scene: '场景',
  prop: '道具',
  motion: '运镜',
  voice: '音色',
};

/** 一个参考元素 = 一张/段参考 + 结构化角色 + 可选元素名(如「女主」「唐刀」「长安夜市」)。 */
export interface ReferenceElement extends ReferenceAsset {
  /** 结构化角色;缺省时由 inferElementRole 从 kind + 自由文本推断。 */
  elementRole?: ElementRole;
  /** 元素显示名。 */
  label?: string;
  /** v9.4.9: 元素强度(对齐可灵 element weight)。角色元素 = cref cw(25-125,越大越锁脸)。 */
  weight?: number;
}

/** cref 强度(cw)区间,与 CAMEO LOCK 一致。 */
export const ELEMENT_WEIGHT_MIN = 25;
export const ELEMENT_WEIGHT_MAX = 125;
export const ELEMENT_WEIGHT_DEFAULT = 100;

/** 夹紧元素强度到合法 cw 区间。 */
export function clampElementWeight(w: unknown): number {
  const v = typeof w === 'number' ? w : Number(w);
  if (!Number.isFinite(v)) return ELEMENT_WEIGHT_DEFAULT;
  return Math.max(ELEMENT_WEIGHT_MIN, Math.min(ELEMENT_WEIGHT_MAX, Math.round(v)));
}

/** 各角色元素上限(对齐可灵「最多约 4 元素」+ 我们按角色细分)。 */
export const MAX_PER_ELEMENT_ROLE: Record<ElementRole, number> = {
  character: 4, style: 2, scene: 3, prop: 4, motion: 2, voice: 2,
};

const ROLE_HINT: { re: RegExp; role: ElementRole }[] = [
  { re: /风格|画风|色调|style|look/i, role: 'style' },
  { re: /场景|背景|环境|世界|scene|background|\bbg\b/i, role: 'scene' },
  { re: /道具|物件|武器|prop/i, role: 'prop' },
  { re: /运镜|镜头|相机|机位|camera|motion/i, role: 'motion' },
  { re: /音色|配音|声音|嗓|voice|audio/i, role: 'voice' },
  { re: /角色|人物|主角|脸|character|face|cast/i, role: 'character' },
];

/** 推断元素角色:显式 elementRole > kind(音/视频)> 自由文本关键词 > 图片默认当角色。 */
export function inferElementRole(el: ReferenceElement): ElementRole {
  if (el.elementRole) return el.elementRole;
  if (el.kind === 'audio') return 'voice';
  if (el.kind === 'video') return 'motion';
  const txt = `${el.role || ''} ${el.label || ''} ${el.name || ''}`;
  for (const h of ROLE_HINT) if (h.re.test(txt)) return h.role;
  return 'character'; // 图片最常见用途 = 锁角色
}

export interface ElementBinding {
  /** 角色参考 → cref + DNA 锁 */
  crefImages: string[];
  /** 风格参考 → sref / Style Bible */
  srefImages: string[];
  /** 场景参考 → 环境/构图上下文 */
  sceneImages: string[];
  /** 道具参考 → 构图上下文 */
  propImages: string[];
  /** 运镜参考(视频) */
  motionVideos: string[];
  /** 音色参考(音频)→ TTS */
  voiceAudios: string[];
  /** 按角色分组(已截断到各上限) */
  byRole: Record<ElementRole, ReferenceElement[]>;
  /** 实际路由进管线的元素数 */
  routed: number;
  /** v9.4.9: 首个角色元素的强度(cref cw),未设则 undefined */
  primaryCharacterWeight?: number;
}

/**
 * 把一组元素按角色路由成"绑定计划",供 orchestrator 喂给对应一致性子系统。
 * 超过各角色上限的元素被丢弃(可灵同样有元素数上限)。无 url 的元素跳过。
 */
export function bindElements(elements: ReferenceElement[]): ElementBinding {
  const byRole: Record<ElementRole, ReferenceElement[]> = {
    character: [], style: [], scene: [], prop: [], motion: [], voice: [],
  };
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || !el.url) continue;
    const role = inferElementRole(el);
    if (byRole[role].length < MAX_PER_ELEMENT_ROLE[role]) {
      byRole[role].push({ ...el, elementRole: role });
    }
  }
  const urls = (r: ElementRole) => byRole[r].map((e) => e.url);
  return {
    crefImages: urls('character'),
    srefImages: urls('style'),
    sceneImages: urls('scene'),
    propImages: urls('prop'),
    motionVideos: urls('motion'),
    voiceAudios: urls('voice'),
    byRole,
    routed: (Object.values(byRole) as ReferenceElement[][]).reduce((n, a) => n + a.length, 0),
    primaryCharacterWeight: typeof byRole.character[0]?.weight === 'number' ? clampElementWeight(byRole.character[0].weight) : undefined,
  };
}

export type CompletenessLevel = 'empty' | 'minimal' | 'good' | 'rich';

export interface ElementCompleteness {
  counts: Record<ElementRole, number>;
  /** 0-100 控制完整度(角色 40 / 风格 25 / 场景 20 / 其余合计 ≤15) */
  score: number;
  level: CompletenessLevel;
  /** 中文引导:缺什么补什么(可灵式"加元素"提示,但落到我们的一致性能力上) */
  hints: string[];
}

/**
 * 评估元素完整度 + 给"还差什么"的引导。角色是骨,风格定调,场景统一世界 —— 加权打分。
 */
export function elementCompleteness(elements: ReferenceElement[]): ElementCompleteness {
  const b = bindElements(elements);
  const counts = (Object.keys(b.byRole) as ElementRole[]).reduce((acc, r) => {
    acc[r] = b.byRole[r].length;
    return acc;
  }, {} as Record<ElementRole, number>);

  const hasC = counts.character > 0;
  const hasS = counts.style > 0;
  const hasScene = counts.scene > 0;

  let score = 0;
  if (hasC) score += 40;
  if (hasS) score += 25;
  if (hasScene) score += 20;
  score += Math.min(15, (counts.prop + counts.motion + counts.voice) * 5);
  score = Math.min(100, score);

  const hints: string[] = [];
  if (!hasC) hints.push('加一张「角色」参考 → 锁主角脸 / 形象(cref + 8 维 DNA)');
  if (!hasS) hints.push('加一张「风格」参考 → 锁整体画风(sref / Style Bible)');
  if (!hasScene) hints.push('加一张「场景」参考 → 统一环境 / 世界观');
  if (!hints.length) hints.push('元素齐全 —— 角色 / 风格 / 场景已就位,可一键成片');

  const level: CompletenessLevel = score === 0 ? 'empty' : score < 45 ? 'minimal' : score < 75 ? 'good' : 'rich';
  return { counts, score, level, hints };
}
