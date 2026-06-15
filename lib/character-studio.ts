/**
 * v6.0 — 角色资产中心 (Character Studio) · 纯逻辑核心
 *
 * 对标 万镜一刻「主体创作」(角色多视角图 / 三维视图 + 音色 + 小传) 与 火山剧创 虚拟人像库,
 * 但只做**经授权的虚拟角色**, 明确不采集/不存储真人面部 (肖像权 + 安全红线)。
 *
 * 三大支柱 (全部纯函数, 不碰网络/DB, 便于单测):
 *   1. 多视角设定图 prompt 合成 —— 基于 character-dna 锁定的身份签名, 为 turnaround
 *      (正/四分之三侧/正侧/背) 各拼一条 prompt, 注入同一份 DNA + "model sheet 一致性"约束。
 *   2. 角色专属音色绑定 —— 按 character-traits 的性别/年龄段, 从音色目录里确定性挑一个 voiceId
 *      (映射到 services/tts.service 的 VOICE_PROFILES)。
 *   3. 角色小传 (bio) —— 从 character-traits 确定性拼一段可读人物档案 (无 key 也能出)。
 *
 * 真正出图 (调 MJ/Minimax 跑这些 prompt)、落库 character_library、UI 生成按钮 → 留 v6.0.1 接线。
 */

import type { CharacterTraits } from './character-traits';
import type { CharacterDna } from './character-dna';
import { buildPromptBlock } from './character-dna';

// ──────────────────────────────────────────────────────────────────────
// 1) 多视角设定图 (turnaround)
// ──────────────────────────────────────────────────────────────────────

export type TurnaroundViewId = 'front' | 'three_quarter' | 'side' | 'back';

export interface TurnaroundViewDef {
  id: TurnaroundViewId;
  /** 中文展示名 */
  label: string;
  /** 拼进 image prompt 的英文机位指令 */
  directive: string;
}

/** turnaround 四视图 (固定顺序: 正面 → 四分之三 → 正侧 → 背面). */
export const TURNAROUND_VIEWS: TurnaroundViewDef[] = [
  { id: 'front', label: '正面', directive: 'front view, facing camera directly, symmetrical pose' },
  { id: 'three_quarter', label: '四分之三侧', directive: 'three-quarter view, body turned about 45 degrees' },
  { id: 'side', label: '正侧面', directive: 'full side profile view, turned 90 degrees' },
  { id: 'back', label: '背面', directive: 'back view, facing away from the camera' },
];

export interface TurnaroundView {
  id: TurnaroundViewId;
  label: string;
  /** 可直接交给 image provider 的完整 prompt */
  prompt: string;
  /** v12.2.6: 派发(generate=true)真出图后回写的 URL;未出图则空 */
  imageUrl?: string;
}

export interface BuildTurnaroundInput {
  name: string;
  /** character-dna 的 promptBlock (身份锁). 没有就退而用 appearance. */
  dnaPromptBlock?: string;
  /** 自然语言外观/服饰描述 (dna 缺失时的身份来源). */
  appearance?: string;
  /** 风格关键词 (例: "国风动漫" / "cinematic realism"). */
  style?: string;
  /** 只出指定视图; 缺省出全部四视图. */
  views?: TurnaroundViewId[];
}

/** turnaround 公共约束 —— 保证四视图是"同一个角色的设定图"而非四张不同的图. */
const SHEET_CONSTRAINT =
  'full body, neutral A-pose, plain light-grey studio background, character model sheet, ' +
  'identical character across all views, same face, same outfit, consistent proportions, no text';

/**
 * 为一个角色合成多视角设定图 prompt 集合. 纯函数.
 * 每条 prompt = 主体(name + 身份块) + 视图机位 + 一致性约束(+ 风格).
 */
export function buildTurnaroundPrompts(input: BuildTurnaroundInput): TurnaroundView[] {
  const name = (input.name || '').trim() || 'the character';
  const identity = (input.dnaPromptBlock && input.dnaPromptBlock.trim())
    || (input.appearance && input.appearance.trim())
    || '';
  const style = (input.style || '').trim();
  const wanted = input.views && input.views.length
    ? TURNAROUND_VIEWS.filter((v) => input.views!.includes(v.id))
    : TURNAROUND_VIEWS;

  return wanted.map((v) => {
    const parts = [name];
    if (identity) parts.push(identity);
    parts.push(v.directive);
    parts.push(SHEET_CONSTRAINT);
    if (style) parts.push(style);
    return { id: v.id, label: v.label, prompt: parts.join(', ') };
  });
}

// ──────────────────────────────────────────────────────────────────────
// 2) 角色专属音色绑定
// ──────────────────────────────────────────────────────────────────────

export type VoiceGender = 'male' | 'female';

export interface VoiceMeta {
  /** 映射到 services/tts.service VOICE_PROFILES 的 voiceId. */
  id: string;
  /** 中文展示名. */
  label: string;
  gender: VoiceGender;
  /** 适配的年龄段 (用 character-traits 的中文枚举). */
  ageGroups: Array<'童年' | '少年' | '青年' | '中年' | '老年'>;
  /** 音色气质关键词. */
  tone: string;
}

/** 内置音色目录 —— voiceId 与 services/tts.service.ts 的 VOICE_PROFILES 对齐. */
export const VOICE_CATALOG: VoiceMeta[] = [
  { id: 'young_female_cn', label: '青年女声', gender: 'female', ageGroups: ['童年', '少年', '青年'], tone: '清亮 灵动' },
  { id: 'narrator_female_cn', label: '成熟女声', gender: 'female', ageGroups: ['中年', '老年'], tone: '温润 沉静' },
  { id: 'young_male_cn', label: '青年男声', gender: 'male', ageGroups: ['童年', '少年', '青年'], tone: '明朗 干净' },
  { id: 'narrator_male_cn', label: '成熟男声', gender: 'male', ageGroups: ['中年', '老年'], tone: '沉稳 醇厚' },
];

const DEFAULT_VOICE_ID = 'narrator_male_cn';

export interface VoicePick {
  voiceId: string;
  label: string;
  /** 是否真按 traits 匹配上 (false = 走了兜底). */
  matched: boolean;
}

/**
 * 按角色 traits (性别 + 年龄段) 确定性挑一个音色. 纯函数.
 * 评分: 性别匹配 +2, 年龄段命中 +1. 取最高分; 平局取目录中靠前者; 全不匹配走兜底.
 */
export function pickVoiceForCharacter(
  traits: Pick<CharacterTraits, 'gender' | 'ageGroup'> | null | undefined,
  catalog: VoiceMeta[] = VOICE_CATALOG,
): VoicePick {
  if (!catalog.length) return { voiceId: DEFAULT_VOICE_ID, label: '默认', matched: false };
  const gender = traits?.gender;
  const age = traits?.ageGroup;

  let best: VoiceMeta | null = null;
  let bestScore = -1;
  for (const v of catalog) {
    let score = 0;
    if ((gender === 'male' || gender === 'female') && v.gender === gender) score += 2;
    if (age && age !== '未明示' && v.ageGroups.includes(age as VoiceMeta['ageGroups'][number])) score += 1;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  // bestScore <= 0 代表既没性别也没年龄命中 → 兜底
  if (!best || bestScore <= 0) {
    const fb = catalog.find((v) => v.id === DEFAULT_VOICE_ID) || catalog[0];
    return { voiceId: fb.id, label: fb.label, matched: false };
  }
  return { voiceId: best.id, label: best.label, matched: true };
}

// ──────────────────────────────────────────────────────────────────────
// 3) 角色小传 (bio)
// ──────────────────────────────────────────────────────────────────────

const AGE_NARRATIVE: Record<string, string> = {
  '童年': '年幼',
  '少年': '少年',
  '青年': '青年',
  '中年': '中年',
  '老年': '年长',
};

/**
 * 从 traits 确定性拼一段可读小传 (无 LLM key 也能出). 纯函数.
 * 句式: "<name>，是一位<年龄><性别>。<体型>，<肤色>肤色，<外观>。常着<服饰>。
 *        性情<性格>。<记号>。" —— "未明示"字段自动跳过, 不硬凑.
 */
export function composeCharacterBio(traits: CharacterTraits): string {
  const skip = (v?: string) => !v || v === '未明示';
  const name = traits.name?.trim() || '该角色';

  const genderLabel = traits.gender === 'male' ? '男性' : traits.gender === 'female' ? '女性' : '';
  const ageLabel = traits.ageGroup !== '未明示' ? (AGE_NARRATIVE[traits.ageGroup] || '') : '';
  const ident = `${ageLabel}${genderLabel}`.trim();

  const sentences: string[] = [];
  sentences.push(ident ? `${name}，是一位${ident}。` : `${name}。`);

  const looks: string[] = [];
  if (!skip(traits.build)) looks.push(traits.build);
  if (!skip(traits.skinTone)) looks.push(`${traits.skinTone}肤色`);
  if (!skip(traits.appearance)) looks.push(traits.appearance);
  if (looks.length) sentences.push(`${looks.join('，')}。`);

  if (!skip(traits.costume)) sentences.push(`常着${traits.costume}。`);
  if (!skip(traits.personality)) sentences.push(`性情${traits.personality}。`);
  if (!skip(traits.signature)) sentences.push(`${traits.signature}。`);

  return sentences.join('');
}

// ──────────────────────────────────────────────────────────────────────
// 4) 角色档案 (CharacterProfile) —— 三支柱打包
// ──────────────────────────────────────────────────────────────────────

export interface CharacterProfile {
  name: string;
  /** 自动小传 */
  bio: string;
  /** 绑定音色 */
  voiceId: string;
  voiceLabel: string;
  voiceMatched: boolean;
  /** 身份锁 prompt 块 (dna 优先, 否则由 traits 回退合成) */
  identityBlock: string;
  /** 多视角设定图 prompt 集 */
  turnaround: TurnaroundView[];
}

export interface BuildProfileInput {
  name?: string;
  traits?: CharacterTraits | null;
  dna?: CharacterDna | null;
  /** 风格关键词, 透传给 turnaround. */
  style?: string;
  /** 限定视图. */
  views?: TurnaroundViewId[];
}

/** traits 缺 dna 时, 从 traits 合成一段身份块 (退化版 DNA), 让 turnaround 仍有身份锚. */
function identityFromTraits(traits: CharacterTraits): string {
  const skip = (v?: string) => !v || v === '未明示';
  const f: string[] = [];
  if (!skip(traits.appearance)) f.push(traits.appearance);
  if (!skip(traits.costume)) f.push(`outfit: ${traits.costume}`);
  if (!skip(traits.signature)) f.push(`signature: ${traits.signature}`);
  return f.length ? `${traits.name} identity: ${f.join('; ')}` : '';
}

/**
 * 打包角色档案: 身份块 + 多视角 prompt + 小传 + 绑定音色. 纯函数 (依赖前三组纯函数).
 */
export function buildCharacterProfile(input: BuildProfileInput): CharacterProfile {
  const name = (input.name || input.dna?.name || input.traits?.name || '').trim() || '未命名角色';

  // 身份块: dna.promptBlock 优先; 其次用 dna.signature 现拼; 再次从 traits 退化; 最后空.
  let identityBlock = '';
  if (input.dna?.promptBlock) identityBlock = input.dna.promptBlock;
  else if (input.dna?.signature) identityBlock = buildPromptBlock(name, input.dna.signature);
  else if (input.traits) identityBlock = identityFromTraits(input.traits);

  const turnaround = buildTurnaroundPrompts({
    name,
    dnaPromptBlock: identityBlock || undefined,
    appearance: input.traits?.appearance,
    style: input.style,
    views: input.views,
  });

  const bio = input.traits ? composeCharacterBio(input.traits) : `${name}。`;
  const voice = pickVoiceForCharacter(input.traits);

  return {
    name,
    bio,
    voiceId: voice.voiceId,
    voiceLabel: voice.label,
    voiceMatched: voice.matched,
    identityBlock,
    turnaround,
  };
}

// ──────────────────────────────────────────────────────────────────────
// 5) 与 character_library 接线 (v6.0.1)
// ──────────────────────────────────────────────────────────────────────

/** character_library 行里本模块要用到的子集 (避免耦合完整 DB 行类型). */
export interface CharacterLibraryRowLike {
  name: string;
  appearance?: string | null;
  description?: string | null;
  style_keywords?: string | null;
}

/**
 * 把 character_library 行映射成 CharacterTraits (供 buildCharacterProfile 用).
 * 库里只有 name/appearance/description 等自由文本, 没有结构化性别/年龄 → 这些填
 * unknown/未明示 (voice 会走兜底, 不瞎猜); appearance 优先取 appearance, 退而取 description.
 */
export function traitsFromLibraryRow(row: CharacterLibraryRowLike): CharacterTraits {
  const appearance = (row.appearance && row.appearance.trim())
    || (row.description && row.description.trim())
    || '未明示';
  return {
    name: row.name || '未命名角色',
    gender: 'unknown',
    ageGroup: '未明示',
    build: '未明示',
    skinTone: '未明示',
    appearance,
    costume: '未明示',
    personality: '未明示',
    signature: '未明示',
    confident: false,
  };
}

/** 从 character_library 行直接生成角色档案. style 缺省取行的 style_keywords. */
export function buildProfileFromLibraryRow(
  row: CharacterLibraryRowLike,
  opts: { style?: string; views?: TurnaroundViewId[] } = {},
): CharacterProfile {
  return buildCharacterProfile({
    name: row.name,
    traits: traitsFromLibraryRow(row),
    style: opts.style ?? (row.style_keywords || undefined) ?? undefined,
    views: opts.views,
  });
}

/** 档案序列化 (落库 character_library.profile). */
export function serializeProfile(profile: CharacterProfile): string {
  return JSON.stringify(profile);
}

/** 档案反序列化 (从 character_library.profile 读). 坏数据返回 null, 不抛. */
export function parseProfile(json: string | null | undefined): CharacterProfile | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (p && typeof p === 'object' && typeof p.name === 'string' && Array.isArray(p.turnaround)) {
      return p as CharacterProfile;
    }
    return null;
  } catch {
    return null;
  }
}

