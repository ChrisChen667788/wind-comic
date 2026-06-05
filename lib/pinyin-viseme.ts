/**
 * lib/pinyin-viseme (v9.6.3) — 轻量「常用字 → 主元音」音素器(零依赖)。
 *
 * 给 `lipsync-plan` 的 CJK 口型提保真:把高频汉字 + 情绪对白字映射到其拼音韵母的**主元音**
 * (a/o/e/i/u,取视觉上最主导的口型),未收录字回退到调用方的码点循环(粗粒度兜底)。
 *
 * 为什么不接重型拼音词典依赖:本项目惯例是零依赖纯逻辑 lib;~270 个高频字按词频已覆盖
 * 日常对白绝大多数发音,主元音决定张口形,足够把「码点占位」升级成「真口型」。按元音
 * 分组、可逐组肉眼校验。
 *
 * 主元音归并(取最主导张口形):
 *   a 系(a/ai/an/ang/ao/ia/ua/uai/uan/ian/iang/uang)→ 'a'(大开口)
 *   o 系(o/ou/ong/uo/iong/iu=iou)→ 'o'(圆唇中)
 *   e 系(e/ei/en/eng/er/ie/üe/ui=uei)→ 'e'(中开)
 *   i 系(i/in/ing)→ 'i'(扁开)
 *   u 系(u/un/ü/ün)→ 'u'(圆唇闭)
 */

export type MouthVowel = 'a' | 'o' | 'e' | 'i' | 'u';

/** 按主元音分组的常用字(可逐组校验);重复以先出现者为准。 */
const GROUPS: Record<MouthVowel, string> = {
  a: '啊吗吧他她它大那来在还海爱开快外上长方当想样将两房帮忙到道好高小笑表要叫老报找年见天面前间点边全关三看但半满慢难家加假下话化发法怕打马把谈断站算盼',
  o: '我哦喔说做作多过国果或火错所左中重种红同动东通用公工空龙从总送有又由友走手头后口都就六牛求油收周愁',
  e: '的了着这者个和喝合河么呢嗯人任认很跟们门本分文问真身什神生声成正政等能冷风为没美内给对会回最水别也夜业写谢些月学雪决而二儿特得乐恶贼',
  i: '一以已意你里力理利是时十实事知只之子自字西习起期其机几己记急第地民心新信进近今行性星明名定听经请情清应英平并病日此次思丝',
  u: '不部出书主住五无武物去取于与语雨路入如度读苦哭怒努母木目福服父富君军春准论树数素哭组',
};

/** char → 主元音 查表(模块加载时构建一次)。 */
const CHAR_VOWEL: Map<string, MouthVowel> = (() => {
  const m = new Map<string, MouthVowel>();
  (Object.keys(GROUPS) as MouthVowel[]).forEach((v) => {
    for (const ch of GROUPS[v]) if (!m.has(ch)) m.set(ch, v);
  });
  return m;
})();

/** 收录的常用字数(自检 / 测试用)。 */
export const COMMON_CHAR_COUNT = CHAR_VOWEL.size;

/**
 * 取常用汉字的主元音;未收录(或非汉字)返回 null(调用方回退兜底)。
 */
export function commonCharVowel(ch: string): MouthVowel | null {
  return CHAR_VOWEL.get(ch) ?? null;
}
