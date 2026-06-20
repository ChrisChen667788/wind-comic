/**
 * @元素注册表 + 跨引擎多参适配(阶段二十五 · Phase 2)
 *
 * 背景(2026-06,联网调研 OnlyShot / Seedance 2.0 / Kling 3.0 OmniVideo / Veo 3.1 Ingredients):
 *   工业级 AI 短剧流水线都用「挂载元素」统一管理角色/场景/道具 —— 给每个元素一个稳定 id
 *   (`@人物{陆晚晚}`),配一组参考图(正面/侧面/3-4 角度),分镜里按 id 引用、复用,
 *   生成时再按各引擎的「多参语法」适配:
 *     · Seedance 2.0 : 位置数组 image_urls[]/video_urls[],prompt 里 @Image1/[Image1] 按序引用
 *     · Kling 3.0    : elements[](每个 frontal_image_url + reference_image_urls[] 多角度)→ @Element1
 *     · Veo 3.1      : 统一 reference_images[](≤3, reference_type='asset'),无 @标记,靠 prompt 点名
 *     · Minimax S2V  : subject_reference[](沿用 v12.9.x,单主角锁定)
 *
 * 本模块是「纯函数」适配层:不碰网络、不碰 DB。orchestrator 把 project assets 投影成 registry,
 * 每个 shot 声明挂载了哪些元素,再用这里的 toXxx() 适配成对应引擎的 payload 形状。
 *
 * 设计取舍:统一 VideoGenerateInput 契约目前每个 subject 只接受 1 个 url(见 video-providers/types.ts),
 * 故 Kling 多角度 reference_image_urls 暂只在本层备好;真正喂进 Kling 需扩契约(Phase 2.1 跟进)。
 */

export type ElementType = 'character' | 'scene' | 'prop' | 'style';

export type AssetRole = 'frontal' | 'side' | 'three_quarter' | 'primary' | 'detail';

export interface ElementAsset {
  role: AssetRole;
  url: string;
}

export interface RegistryElement {
  /** 稳定 id,如 `@人物{陆晚晚}` */
  id: string;
  type: ElementType;
  /** 人类可读名(= 资产名,分镜 beat.characters/scene 用它引用) */
  name: string;
  /** 外观/特征(锁一致性的文字锚点) */
  traits?: string;
  /** 参考图(按 role;frontal/primary 优先级最高) */
  assets: ElementAsset[];
}

export type ElementsRegistry = Record<string, RegistryElement>;

const TYPE_TOKEN: Record<ElementType, string> = {
  character: '人物', scene: '场景', prop: '道具', style: '风格',
};
const TOKEN_TYPE: Record<string, ElementType> = {
  人物: 'character', 场景: 'scene', 道具: 'prop', 风格: 'style',
};

/** 生成稳定 id:`@人物{陆晚晚}`。name 去前后空白。 */
export function elementId(type: ElementType, name: string): string {
  return `@${TYPE_TOKEN[type]}{${(name || '').trim()}}`;
}

/** 解析 id → {type,name};非法返回 null。 */
export function parseElementId(id: string): { type: ElementType; name: string } | null {
  const m = /^@(人物|场景|道具|风格)\{(.+)\}$/.exec((id || '').trim());
  if (!m) return null;
  return { type: TOKEN_TYPE[m[1]], name: m[2].trim() };
}

const isHttp = (u?: string): u is string =>
  !!u && !u.startsWith('data:') && (u.startsWith('http') || u.startsWith('/api/serve-file'));

function pickAssets(raw: any): ElementAsset[] {
  const out: ElementAsset[] = [];
  // 显式 refs 列表(带 role)
  if (Array.isArray(raw?.refs)) {
    for (const r of raw.refs) {
      const url = typeof r === 'string' ? r : r?.url;
      if (isHttp(url)) out.push({ role: (r?.role as AssetRole) || 'primary', url });
    }
  }
  // 单图兜底(imageUrl / mediaUrls[0])
  const single = raw?.imageUrl || (Array.isArray(raw?.mediaUrls) ? raw.mediaUrls[0] : undefined);
  if (isHttp(single) && !out.some((a) => a.url === single)) {
    out.unshift({ role: out.length ? 'detail' : 'primary', url: single });
  }
  return out;
}

/**
 * 从 project assets 投影出 @元素注册表。
 * 角色 → @人物{name};场景 → @场景{location||name};道具 → @道具{name}。
 * 名字冲突时后者覆盖前者(同名取最新)。
 */
export function buildElementsRegistry(input: {
  characters?: Array<any>;
  scenes?: Array<any>;
  props?: Array<any>;
}): ElementsRegistry {
  const reg: ElementsRegistry = {};
  const add = (type: ElementType, name: string, traits: string | undefined, assets: ElementAsset[]) => {
    const nm = (name || '').trim();
    if (!nm) return;
    const id = elementId(type, nm);
    reg[id] = { id, type, name: nm, traits: traits || undefined, assets };
  };
  for (const c of input.characters || []) {
    const nm = c?.name || c?.character || '';
    add('character', nm, c?.appearance || c?.description, pickAssets(c));
  }
  for (const s of input.scenes || []) {
    const nm = s?.location || s?.name || '';
    add('scene', nm, s?.description, pickAssets(s));
  }
  for (const p of input.props || []) {
    add('prop', p?.name || '', p?.description || p?.traits, pickAssets(p));
  }
  return reg;
}

/** 按名字在 registry 里找元素(支持传完整 id 或纯名字);type 可缩小范围。 */
export function resolveElement(reg: ElementsRegistry, nameOrId: string, type?: ElementType): RegistryElement | undefined {
  if (!nameOrId) return undefined;
  const parsed = parseElementId(nameOrId);
  if (parsed) return reg[nameOrId];
  // 纯名字:在指定 type(或全部)里匹配
  for (const el of Object.values(reg)) {
    if (type && el.type !== type) continue;
    if (el.name === nameOrId.trim()) return el;
  }
  return undefined;
}

export interface ShotMount {
  characters: RegistryElement[];
  scene?: RegistryElement;
  props: RegistryElement[];
}

/** 把一个 shot 声明的(角色名[]/场景名/道具名[])解析成有序、去重的挂载。 */
export function mountForShot(
  reg: ElementsRegistry,
  decl: { characters?: string[]; scene?: string; props?: string[] },
): ShotMount {
  const seen = new Set<string>();
  const characters: RegistryElement[] = [];
  for (const nm of decl.characters || []) {
    const el = resolveElement(reg, nm, 'character');
    if (el && el.assets.length && !seen.has(el.id)) { characters.push(el); seen.add(el.id); }
  }
  const scene = decl.scene ? resolveElement(reg, decl.scene, 'scene') : undefined;
  const props: RegistryElement[] = [];
  for (const nm of decl.props || []) {
    const el = resolveElement(reg, nm, 'prop');
    if (el && el.assets.length && !seen.has(el.id)) { props.push(el); seen.add(el.id); }
  }
  return { characters, scene: scene && scene.assets.length ? scene : undefined, props };
}

const frontal = (el: RegistryElement): string | undefined =>
  (el.assets.find((a) => a.role === 'frontal' || a.role === 'primary') || el.assets[0])?.url;
const nonFrontal = (el: RegistryElement): string[] => {
  const f = frontal(el);
  return el.assets.filter((a) => a.url !== f).map((a) => a.url);
};

/**
 * Seedance 2.0 适配:image_urls 按「角色(身份锚点,最前)→ 场景 → 道具(细节,最末)」排序,
 * 返回 prompt 里要并入的 @Image 引用说明(@Image1 as character reference for 陆晚晚 ...)。
 */
export function toSeedanceSlots(mount: ShotMount): { imageUrls: string[]; mentions: string[] } {
  const imageUrls: string[] = [];
  const mentions: string[] = [];
  const push = (url: string | undefined, label: string) => {
    if (!url) return;
    imageUrls.push(url);
    mentions.push(`@Image${imageUrls.length} ${label}`);
  };
  for (const c of mount.characters) push(frontal(c), `as character reference for ${c.name}, keep facial features & outfit consistent`);
  if (mount.scene) push(frontal(mount.scene), `as scene/background reference (${mount.scene.name})`);
  for (const p of mount.props) push(frontal(p), `as prop detail reference (${p.name})`);
  return { imageUrls, mentions };
}

/**
 * Kling 3.0 OmniVideo 适配:elements[](角色+道具,每个 frontal + 多角度 refs),image_urls[0]=场景。
 */
export function toKlingElements(mount: ShotMount): {
  elements: Array<{ frontal_image_url: string; reference_image_urls: string[] }>;
  imageUrls: string[];
} {
  const elements: Array<{ frontal_image_url: string; reference_image_urls: string[] }> = [];
  for (const el of [...mount.characters, ...mount.props]) {
    const f = frontal(el);
    if (f) elements.push({ frontal_image_url: f, reference_image_urls: nonFrontal(el) });
  }
  const sceneUrl = mount.scene ? frontal(mount.scene) : undefined;
  return { elements, imageUrls: sceneUrl ? [sceneUrl] : [] };
}

/**
 * 统一 VideoGenerateInput.subjectReferences[] —— 每角色 frontal 作 imageUrl、其余角度作 refImageUrls。
 * Minimax S2V 只用 imageUrl;Kling Elements 用 frontal + refImageUrls(多角度)。
 */
export function subjectReferencesFromMount(mount: ShotMount): Array<{ imageUrl: string; name: string; refImageUrls: string[] }> {
  const out: Array<{ imageUrl: string; name: string; refImageUrls: string[] }> = [];
  for (const c of mount.characters) {
    const f = frontal(c);
    if (f) out.push({ imageUrl: f, name: c.name, refImageUrls: nonFrontal(c) });
  }
  return out;
}

/**
 * Veo 3.1 Ingredients 适配:reference_images[](≤max,默认 3;角色→场景→道具),无 @标记。
 */
export function toVeoReferenceImages(mount: ShotMount, max = 3): string[] {
  const out: string[] = [];
  for (const c of mount.characters) { const f = frontal(c); if (f) out.push(f); }
  if (mount.scene) { const f = frontal(mount.scene); if (f) out.push(f); }
  for (const p of mount.props) { const f = frontal(p); if (f) out.push(f); }
  return [...new Set(out)].slice(0, max);
}

/**
 * 把 Seedance/即梦 的 @Image 引用说明并入 prompt(仅给「认 @图片N 语法」的引擎,
 * 如 Seedance 2.0 / 即梦;Veo/Minimax/Kling 不认 @Image 文本,不要调用)。
 */
export function annotateSeedancePrompt(prompt: string, mount: ShotMount): string {
  const { mentions } = toSeedanceSlots(mount);
  if (!mentions.length) return prompt;
  return `${prompt}\n[Multi-reference] ${mentions.join('; ')}.`;
}

/**
 * 同场景判定 —— 给「上一镜真末帧链式 I2V」做防串帧守卫(承接 v12.9.1 #3 的「同场景检测」前置)。
 * Writer 标了 transition='continuous' 表示同场景连续动作,但若误标跨场景,用真末帧续接会串错背景。
 * 规则:两段场景描述任一未知 → 视为兼容(信任 transition);都已知则归一化后需相等或长串含短串强前缀。
 */
export function scenesLikelySame(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  const norm = (s: string) =>
    s.toLowerCase().replace(/延续|continued?/g, '').replace(/[\s，。、（）()【】[\]·:：，,.\-—]/g, '');
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  const probeLen = Math.max(6, Math.floor(short.length * 0.6));
  return long.includes(short.slice(0, probeLen));
}
