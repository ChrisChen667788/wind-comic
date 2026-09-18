/**
 * 锁角色净化(v12.198.0,纯函数)。
 *
 * 从 create-pipeline 抽取:请求体传入的 lockedCharacters 常来自前端/模板/外部导入,
 * 必须严格白名单校验(name/role/cw/imageUrl + traits 六维),挡任意 JSON 注入。
 * 硬上限 3 个(与前端 UI 一致)。create-pipeline 与项目详情页「角色档案」API 共用,
 * 保证两条写入路径的净化语义逐字节一致。
 */

/** 角度参考图(v12.447):正面之外的其它角度,给多图参考引擎用 */
export interface CharacterAngleRef {
  /** 与 lib/elements-registry 的 AssetRole 同一词表 */
  role: 'frontal' | 'side' | 'three_quarter' | 'primary' | 'detail';
  url: string;
}

/** 每个角色最多带几张角度图 —— 可灵 Elements 是「1 正面 + 3 参考」,取同一口径 */
export const MAX_ANGLE_REFS = 3;

export interface SanitizedLockedCharacter {
  name: string;
  role: 'lead' | 'antagonist' | 'supporting' | 'cameo';
  cw: number;
  imageUrl: string;
  /**
   * v12.447:多角度参考图。此前这一路**全程被剥**:装配层(elements-registry)早就会读
   * `refs` 并产出 `reference_image_urls`,但两道白名单只放行 name/role/cw/imageUrl/traits,
   * 于是角色库出的转身图永远到不了出片端 —— 造好没接线,本仓最顽固的一类毛病。
   */
  refs?: CharacterAngleRef[];
  traits?: {
    name: string;
    gender: 'male' | 'female' | 'unknown';
    ageGroup: string;
    build: string;
    skinTone: string;
    appearance: string;
    costume: string;
    personality: string;
    signature: string;
    confident: boolean;
  };
}

/** v12.447:角度图里能发给引擎的地址(只收 http(s))—— 编排器几处共用这一份过滤,不各写一份 */
export function angleRefUrls(refs: ReadonlyArray<{ url?: unknown }> | undefined): string[] {
  return (refs || []).map((r) => r?.url).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
}

/** v12.447:按角色名取锁定角色的角度图 —— 整片生成的 mrBundle 与元素注册表手里只有名字 */
export function findAngleRefs<T extends { url: string }>(
  locked: ReadonlyArray<{ name?: string; refs?: T[] }> | undefined, name: string | undefined,
): T[] | undefined {
  const refs = (locked || []).find((l) => l?.name === name)?.refs;
  return refs && refs.length ? refs : undefined;
}

const ROLES = ['lead', 'antagonist', 'supporting', 'cameo'];
const ANGLE_ROLES = ['frontal', 'side', 'three_quarter', 'primary', 'detail'];

/**
 * 净化角度图:只收 http(s) URL、角色名必须在词表内、去重、截前 3。
 * 不认识的角色名归一到 'detail' 而不是丢弃 —— 用户传了图却整张消失,比标签不准更糟。
 */
function sanitizeAngleRefs(v: unknown, frontUrl: string): CharacterAngleRef[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>([frontUrl]);
  const out: CharacterAngleRef[] = [];
  for (const r of v) {
    const url = typeof r?.url === 'string' ? r.url.trim() : '';
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ role: (ANGLE_ROLES.includes(r?.role) ? r.role : 'detail') as CharacterAngleRef['role'], url });
    if (out.length >= MAX_ANGLE_REFS) break;
  }
  return out.length ? out : undefined;
}
const AGE_GROUPS = ['童年', '少年', '青年', '中年', '老年', '未明示'];

/** 单个 traits 白名单净化;非对象 → undefined。 */
function sanitizeTraits(t: any): SanitizedLockedCharacter['traits'] | undefined {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return undefined;
  return {
    name: typeof t.name === 'string' ? t.name.slice(0, 40) : '',
    gender: ['male', 'female', 'unknown'].includes(t.gender) ? t.gender : 'unknown',
    ageGroup: AGE_GROUPS.includes(t.ageGroup) ? t.ageGroup : '未明示',
    build: typeof t.build === 'string' ? t.build.slice(0, 60) : '未明示',
    skinTone: typeof t.skinTone === 'string' ? t.skinTone.slice(0, 30) : '未明示',
    appearance: typeof t.appearance === 'string' ? t.appearance.slice(0, 100) : '未明示',
    costume: typeof t.costume === 'string' ? t.costume.slice(0, 100) : '未明示',
    personality: typeof t.personality === 'string' ? t.personality.slice(0, 60) : '未明示',
    signature: typeof t.signature === 'string' ? t.signature.slice(0, 60) : '未明示',
    confident: t.confident === true,
  };
}

/** 净化锁角色数组:滤掉无 imageUrl/无 name 的槽位,截前 3,白名单每个字段。 */
export function sanitizeLockedCharacters(list: unknown): SanitizedLockedCharacter[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c: any) => c && typeof c.imageUrl === 'string' && c.imageUrl && typeof c.name === 'string' && c.name.trim())
    .slice(0, 3)
    .map((c: any) => {
      const safeTraits = sanitizeTraits(c?.traits);
      const imageUrl = String(c.imageUrl);
      const refs = sanitizeAngleRefs(c?.refs, imageUrl);
      return {
        name: String(c.name).trim().slice(0, 40),
        role: (ROLES.includes(c.role) ? c.role : 'lead') as SanitizedLockedCharacter['role'],
        cw: Number.isFinite(c.cw) ? Math.max(25, Math.min(125, Math.round(c.cw))) : 100,
        imageUrl,
        ...(safeTraits ? { traits: safeTraits } : {}),
        ...(refs ? { refs } : {}),
      };
    });
}
