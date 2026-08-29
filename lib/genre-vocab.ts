/**
 * lib/genre-vocab (v12.362) —— 题材/情绪判定词表,**全仓唯一一份**。
 *
 * 病根:同一个「是不是古装」的判断,在四个文件里各写了一遍,而且**四份都用单字**:
 *   lib/prompt-templates:39     /古装|宫|侠|剑|秦|唐|宋|明|清/
 *   lib/style-bible:39          /古装|秦|唐|宋|明|清|朝|宫|侠|武|仙|修|汉服|.../
 *   lib/idea-normalizer:123     /古装|宫|侠|剑|秦|唐|宋|明|清/
 *   lib/screenwriter-enhance:166 /古|侠|将军|皇|帝|仙/
 *
 * 实测误命中(全是正当的现代广告文案):
 *   「现代都市广告,画面**清**新**明**亮」  → 古装  ×3 处
 *   「咖啡店里,阳光**明**媚的**清**晨」    → 古装  ×3 处
 *   「运动品牌广告,热**血**沸腾的比赛」    → 恐怖
 *
 * `prompt-templates` 的那处后果最远:结果会被写成
 * 「4. 题材锁定:古装(**用户已指定**,严格遵守)」塞进剧本 prompt ——
 * **一句用户从没说过的话,却标着「用户已指定」**。owner 的电商广告、汽车广告
 * 都是这样被锁成古装的(v12.358 修数据时确认)。
 *
 * 两条规矩:
 * ① **一律双字及以上实词**;英文加 `\b` 词界。单字在自由文本里几乎必然误命中。
 * ② **判不出就返回 false**,由调用方决定默认值 —— 词表不替调用方猜。
 */

/** 古装/武侠/仙侠。注意没有单字 `古`(复古)、`清`(清新)、`明`(明亮)、`朝`(朝气)。 */
export const ANCIENT_RE =
  /古装|古风|汉服|武侠|仙侠|修仙|修真|宫廷|朝代|王朝|秦朝|汉朝|唐朝|宋朝|明朝|清朝|大内|江湖|侠客|剑客|将军|皇帝|皇后|贵妃|太子|格格|锦衣卫|\bwuxia\b|\bxianxia\b|\bdynasty\b|\bhanfu\b|\bimperial\b/;

/** 赛博/科幻。注意没有裸 `ai`(hair/waist/fair 都含它)。 */
export const SCIFI_RE =
  /赛博|科幻|未来感|太空|机甲|机器人|人工智能|全息|量子|星际|\bcyberpunk\b|\bsci-?fi\b|\bfuturistic\b|\bmecha\b|\bandroid\b|\bhologram\b/;

/** 恐怖/惊悚。注意没有单字 `血`(热血沸腾)、`鬼`(鬼才/搞鬼)。 */
export const HORROR_RE =
  /恐怖|惊悚|鬼怪|闹鬼|恶鬼|血腥|凶宅|灵异|诡异|恐惧|吓人|\bhorror\b|\bthriller\b|\bhaunted\b/;

/** 悲情。注意没有单字 `悲`(慈悲)、`哭`、`泪`(泪光可以是喜极而泣)。 */
export const SAD_RE =
  /悲伤|悲痛|悲剧|痛哭|哭泣|落泪|泪水|泪流|绝望|心碎|遗憾|哀伤|凄凉|\bgrief\b|\btragic\b|\bsorrow\b/;

/** 现代/都市。 */
export const MODERN_RE =
  /现代|当代|都市|职场|校园|写字楼|便利店|地铁|公寓|商场|\bmodern\b|\bcontemporary\b|\burban\b/;

/** 中世纪奇幻。 */
export const FANTASY_RE =
  /中世纪|骑士|魔法|奇幻|精灵族|矮人族|龙族|\bmedieval\b|\bknight\b|\bfantasy\b|\belven\b/;

/** 民国。 */
export const REPUBLIC_RE = /民国|旗袍|中山装|\b19[234]0s?\b|\brepublic era\b/i;

export type GenreKind = 'ancient' | 'scifi' | 'horror' | 'sad' | 'modern' | 'fantasy' | 'republic';

const ORDER: Array<[GenreKind, RegExp]> = [
  ['ancient', ANCIENT_RE], ['scifi', SCIFI_RE], ['fantasy', FANTASY_RE],
  ['republic', REPUBLIC_RE], ['modern', MODERN_RE],
];

/**
 * 判题材。**判不出返回 null** —— 不替调用方猜默认值。
 * 顺序有意:古装/科幻/奇幻/民国这些「强题材」优先于「现代」,
 * 因为「现代」的词(都市/职场)常与它们共现。
 */
export function detectGenreKind(text: string | null | undefined): GenreKind | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const [kind, re] of ORDER) if (re.test(t)) return kind;
  return null;
}

/** 便捷判定 —— 供只关心单一维度的调用方用。 */
export const isAncient = (t?: string | null) => ANCIENT_RE.test(t || '');
export const isHorror = (t?: string | null) => HORROR_RE.test(t || '');
export const isSad = (t?: string | null) => SAD_RE.test(t || '');
