/**
 * lib/character-gender (v12.346) —— 从**剧本本身**推断角色性别,而不是猜名字。
 *
 * 病根:音色选路最终落到 `inferTraitsFromName`,而那份词表只认**称谓词**
 * (叔/爷/姐/妹/夫人/公子…),不认中文人名。拿 owner 真实的 53 个角色实测:
 * **只判得出 4 个(8%)**,其余 49 个退回「全目录确定性散列」—— 性别随机。
 * 而 v12.338 的 voice-cast 会把结果**持久化**,柳如烟一旦被散列到男声就永久锁死。
 *
 * 但剧本里其实**写着答案**:分镜的 `visualPrompt` 是给图像引擎的英文描述,
 * 必然点明人物性别("young Chinese man with bronze tan complexion")。
 * 同一实测集上,单角色镜投票 **21/21 全部判对**。
 *
 * 所以这里不扩充姓名词典(那是猜),而是**读剧本这个事实来源**。
 * 判不出就返回 undefined,交回原有链路 —— 延续「不瞎猜」的既有约定。
 */

/** 只用**单角色镜**投票:多角色镜里的性别词归属不清,宁可不投。 */
const MALE_EN = /\b(man|male|boy|gentleman|father|husband|brother|son|his|himself)\b/i;
const FEMALE_EN = /\b(woman|female|girl|lady|mother|wife|sister|daughter|her|herself)\b/i;
/** 中文兜底(部分剧本的 visualPrompt 是中文)。 */
const MALE_CN = /男(人|子|孩|性)|少年|青年男|老者|父亲|丈夫|兄长/;
const FEMALE_CN = /女(人|子|孩|性)|少女|青年女|妇人|母亲|妻子|姐姐|妹妹/;

export type Gender = 'male' | 'female';

export interface GenderVote {
  male: number;
  female: number;
  /** 有把握才给结论;票数接近 → undefined */
  verdict?: Gender;
  /** 参与投票的单角色镜数 */
  shots: number;
}

export interface ShotLike {
  characters?: string[] | null;
  visualPrompt?: string | null;
  sceneDescription?: string | null;
}

/**
 * 统计每个角色的性别票。**纯函数** —— 不碰 DB、不碰网络,便于单测。
 *
 * 判定:一边有票另一边为 0 → 直接定;两边都有票 → 需 2 倍以上优势才定,
 * 否则留空(镜头里常出现第二个未具名人物,会污染少量票)。
 */
export function voteGenderFromShots(shots: ShotLike[] | null | undefined): Map<string, GenderVote> {
  const out = new Map<string, GenderVote>();
  for (const s of Array.isArray(shots) ? shots : []) {
    const chars = (s?.characters || []).filter((c): c is string => typeof c === 'string' && !!c.trim());
    // 只认单角色镜 —— 多角色镜无法把性别词归到具体人身上
    if (chars.length !== 1) continue;
    const name = chars[0].trim();
    const text = `${s?.visualPrompt || ''} ${s?.sceneDescription || ''}`;
    if (!text.trim()) continue;

    const v = out.get(name) || { male: 0, female: 0, shots: 0 };
    v.shots++;
    if (MALE_EN.test(text) || MALE_CN.test(text)) v.male++;
    if (FEMALE_EN.test(text) || FEMALE_CN.test(text)) v.female++;
    out.set(name, v);
  }
  for (const v of out.values()) {
    if (v.male && !v.female) v.verdict = 'male';
    else if (v.female && !v.male) v.verdict = 'female';
    else if (v.male > v.female * 2) v.verdict = 'male';
    else if (v.female > v.male * 2) v.verdict = 'female';
    // 否则不给结论
  }
  return out;
}

/** 便捷形态:只要有结论的那些。 */
export function inferGenderFromScript(shots: ShotLike[] | null | undefined): Map<string, Gender> {
  const out = new Map<string, Gender>();
  for (const [name, v] of voteGenderFromShots(shots)) if (v.verdict) out.set(name, v.verdict);
  return out;
}

/**
 * 组装成 `resolveCastVoices` 认得的线索表。
 * **剧本证据优先于姓名词表** —— 前者是事实,后者是启发式。
 */
export function buildCastHints(
  shots: ShotLike[] | null | undefined,
): Map<string, { gender?: Gender }> {
  const hints = new Map<string, { gender?: Gender }>();
  for (const [name, g] of inferGenderFromScript(shots)) hints.set(name, { gender: g });
  return hints;
}
