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
  /**
   * v12.274:该档的**韵律**(语速/音高/音量)。
   *
   * 病根:v12.229 把音色目录从 4 扩到 22,但 tts.service 的 VOICE_PROFILES **仍只有 4 条** ——
   * 另外 18 档全部落进 `VOICE_PROFILES[voiceId] || 默认旁白男声` 的兜底,于是
   * 「俏皮少女」「奶音男孩」的**音色换了、腔调没换**:语速 1.0、音高 0,与成熟男旁白逐字节相同。
   * 根因是两份表各写各的必然漂移 —— 故本版把韵律**并进目录**,由 tts.service 派生,
   * 结构上不可能再出现「目录有、profile 没有」。缺省时按 narrator 档兜底(与旧行为一致)。
   */
  speed?: number;
  pitch?: number;
  vol?: number;
  /**
   * v12.229:该档在 **MiniMax** 上的真实系统音色 id。
   *
   * 为什么必须显式给:此前 catalog 的 id(`narrator_male_cn` 等)被**原样**发给 MiniMax,
   * 而 MiniMax 根本不认 —— live 探测返回 `2054 voice id not exist`,与随手编的假 id 反应一致。
   * 也就是说走 MiniMax 路径时,按角色路由的音色**从来没出过声**。
   * 这里的每个值都经 live 探测确认可用(23/27 候选通过),不是照文档抄的。
   */
  minimax: string;
  /**
   * v12.229:该档在 **OpenAI 兼容 TTS**(vectorengine,生产主路径)上的音色。
   *
   * 此前 `mapVoiceToOpenAI` 只按正则把所有音色压成 3 个(女→nova / 男→onyx / 其余→alloy),
   * 于是"同性别多角色池内轮转避免撞嗓"被彻底抹平 —— 全片女角一个嗓、男角一个嗓。
   * 显式给值后,不同档位才真的落到不同 OpenAI 音色。
   */
  openai: string;
}

/** 内置音色目录 —— voiceId 与 services/tts.service.ts 的 VOICE_PROFILES 对齐. */
/**
 * 音色目录(v12.229 从 4 档扩到 22 档)。
 *
 * 病根(🟠-14 的实况比报告更糟):原本只有 4 档(男女各 2),8 角色项目每性别只有 2 个可轮转;
 * 而且**两条 provider 路径都是坏的** ——
 *   · MiniMax(兜底路径):原 id 被原样下发,live 探测恒 `2054 voice id not exist`,routed 音色不出声;
 *   · vectorengine/OpenAI(主路径):`mapVoiceToOpenAI` 用正则把一切压成 nova/onyx/alloy 三个,
 *     所谓"避免撞嗓"的轮转被抹平,实际全片女角同嗓、男角同嗓。
 * 所以只把 4 扩到 20 是治不好的 —— 必须让每档带上**各 provider 的真实音色 id**。
 *
 * 下列 `minimax` 值**逐个 live 探测确认可用**(27 个候选中 23 个通过,未通过的已剔除,不写进目录)。
 * `openai` 用 6 个经典音色(alloy/echo/fable/onyx/nova/shimmer)按性别分配后轮转 ——
 * 数量少于 MiniMax,故同性别超过 3 个角色时 OpenAI 路径仍会复用,但已从"2 个"提升到"6 个"。
 * 前 4 档 id 保持不变(narrator_male_cn 等),既有项目的 voice-overrides / 旁白配置不受影响。
 */
export const VOICE_CATALOG: VoiceMeta[] = [
  // ── 兼容档:id 保持 v9.7.4 以来不变,避免既有覆盖配置失效 ──
  { id: 'young_female_cn', label: '青年女声', gender: 'female', ageGroups: ['童年', '少年', '青年'], tone: '清亮 灵动', speed: 1.05, pitch: 3, minimax: 'female-shaonv', openai: 'nova' },
  { id: 'narrator_female_cn', label: '成熟女声', gender: 'female', ageGroups: ['中年', '老年'], tone: '温润 沉静', speed: 1.0, pitch: 0, minimax: 'female-yujie', openai: 'shimmer' },
  { id: 'young_male_cn', label: '青年男声', gender: 'male', ageGroups: ['童年', '少年', '青年'], tone: '明朗 干净', speed: 1.1, pitch: 2, minimax: 'male-qn-qingse', openai: 'echo' },
  { id: 'narrator_male_cn', label: '成熟男声', gender: 'male', ageGroups: ['中年', '老年'], tone: '沉稳 醇厚', speed: 1.0, pitch: 0, minimax: 'presenter_male', openai: 'onyx' },

  // ── 女声扩容 ──
  { id: 'mature_female_cn', label: '知性女声', gender: 'female', ageGroups: ['青年', '中年'], tone: '知性 从容', speed: 0.98, pitch: 0, minimax: 'female-chengshu', openai: 'nova' },
  { id: 'sweet_female_cn', label: '甜美女声', gender: 'female', ageGroups: ['少年', '青年'], tone: '甜软 亲和', speed: 1.05, pitch: 2, minimax: 'female-tianmei', openai: 'shimmer' },
  { id: 'presenter_female_cn', label: '女主播', gender: 'female', ageGroups: ['青年', '中年'], tone: '播音 清晰', speed: 1.0, pitch: 0, minimax: 'presenter_female', openai: 'fable' },
  { id: 'audiobook_female1_cn', label: '女有声书①', gender: 'female', ageGroups: ['青年', '中年'], tone: '叙述 平稳', speed: 0.95, pitch: 0, minimax: 'audiobook_female_1', openai: 'nova' },
  { id: 'audiobook_female2_cn', label: '女有声书②', gender: 'female', ageGroups: ['中年', '老年'], tone: '娓娓 醇和', speed: 0.92, pitch: -1, minimax: 'audiobook_female_2', openai: 'shimmer' },
  { id: 'lovely_girl_cn', label: '俏皮少女', gender: 'female', ageGroups: ['童年', '少年'], tone: '俏皮 跳脱', speed: 1.12, pitch: 4, minimax: 'lovely_girl', openai: 'fable' },
  { id: 'tianxin_girl_cn', label: '甜心小铃', gender: 'female', ageGroups: ['童年', '少年'], tone: '娇憨 明快', speed: 1.1, pitch: 4, minimax: 'tianxin_xiaoling', openai: 'nova' },

  // ── 男声扩容 ──
  { id: 'elite_male_cn', label: '精英男声', gender: 'male', ageGroups: ['青年', '中年'], tone: '干练 利落', speed: 1.05, pitch: 0, minimax: 'male-qn-jingying', openai: 'onyx' },
  { id: 'domineering_male_cn', label: '霸道男声', gender: 'male', ageGroups: ['青年', '中年'], tone: '强势 压场', speed: 0.95, pitch: -2, minimax: 'male-qn-badao', openai: 'echo' },
  { id: 'student_male_cn', label: '学生男声', gender: 'male', ageGroups: ['少年', '青年'], tone: '青涩 朝气', speed: 1.08, pitch: 1, minimax: 'male-qn-daxuesheng', openai: 'alloy' },
  { id: 'audiobook_male1_cn', label: '男有声书①', gender: 'male', ageGroups: ['青年', '中年'], tone: '叙述 稳重', speed: 0.95, pitch: 0, minimax: 'audiobook_male_1', openai: 'onyx' },
  { id: 'audiobook_male2_cn', label: '男有声书②', gender: 'male', ageGroups: ['中年', '老年'], tone: '低沉 厚重', speed: 0.92, pitch: -2, minimax: 'audiobook_male_2', openai: 'echo' },
  { id: 'clever_boy_cn', label: '机灵男孩', gender: 'male', ageGroups: ['童年', '少年'], tone: '机灵 脆亮', speed: 1.12, pitch: 4, minimax: 'clever_boy', openai: 'alloy' },
  { id: 'cute_boy_cn', label: '奶音男孩', gender: 'male', ageGroups: ['童年'], tone: '奶声 软糯', speed: 1.08, pitch: 4, minimax: 'cute_boy', openai: 'fable' },
  { id: 'junlang_male_cn', label: '俊朗男友', gender: 'male', ageGroups: ['青年'], tone: '温柔 清朗', speed: 1.02, pitch: 0, minimax: 'junlang_nanyou', openai: 'echo' },
  { id: 'chunzhen_male_cn', label: '纯真学弟', gender: 'male', ageGroups: ['少年', '青年'], tone: '纯真 腼腆', speed: 1.05, pitch: 1, minimax: 'chunzhen_xuedi', openai: 'alloy' },
  { id: 'lengdan_male_cn', label: '冷淡兄长', gender: 'male', ageGroups: ['青年', '中年'], tone: '清冷 疏离', speed: 0.95, pitch: -1, minimax: 'lengdan_xiongzhang', openai: 'onyx' },
  { id: 'badao_shaoye_cn', label: '霸道少爷', gender: 'male', ageGroups: ['少年', '青年'], tone: '骄矜 张扬', speed: 1.0, pitch: -1, minimax: 'badao_shaoye', openai: 'fable' },
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
  /**
   * v12.287:角色名 —— **仅用于同分候选的散列**。
   *
   * 病根:原实现用 `score > bestScore`,**同分时永远取目录里第一个**;
   * 而前 4 档兼容音色(青年男/成熟男/青年女/成熟女)恰好覆盖了全部 10 种性别×年龄组合,
   * 于是 **22 档目录实际只能挑出 4 档** —— v12.229 的扩容与 v12.274 的逐档韵律,
   * 在这条路径上等于白做;同性别同年龄的多个角色还必然**撞同一把嗓子**。
   *
   * 现在:取**并列最高分的全部候选**,按角色名确定性哈希选一个 —— 同名恒定同音色(可复现),
   * 不同角色则散得开。**不传 name 时行为与旧版逐字节一致**(仍取第一个),故既有调用零回归。
   */
  name?: string,
): VoicePick {
  if (!catalog.length) return { voiceId: DEFAULT_VOICE_ID, label: '默认', matched: false };
  const gender = traits?.gender;
  const age = traits?.ageGroup;

  let best: VoiceMeta | null = null;
  let bestScore = -1;
  const tied: VoiceMeta[] = [];
  for (const v of catalog) {
    let score = 0;
    if ((gender === 'male' || gender === 'female') && v.gender === gender) score += 2;
    if (age && age !== '未明示' && v.ageGroups.includes(age as VoiceMeta['ageGroups'][number])) score += 1;
    if (score > bestScore) { bestScore = score; best = v; tied.length = 0; tied.push(v); }
    else if (score === bestScore) { tied.push(v); }
  }
  // v12.287:有名字且存在并列 → 在并列集合内按名字哈希散开(否则沿用「第一个」,零回归)
  if (name && tied.length > 1) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
    best = tied[h % tied.length];
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

