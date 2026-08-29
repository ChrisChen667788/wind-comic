/**
 * 情绪 → MiniMax TTS emotion 枚举映射(v12.211.0,纯函数)。
 *
 * 病根:orchestrator 把 shot.emotion 的**中文自由文本**(如「悲伤」「激动」)直接透传给
 * MiniMax voice_setting.emotion,但官方只认 7 个英文枚举(happy/sad/angry/fearful/
 * disgusted/surprised/neutral)—— 中文被忽略,情感 TTS 从未真正生效。本函数把中文情绪词
 * 归一到合法枚举,让 speech-2.8-hd 的情感表达真正接通。无法识别 → neutral(安全)。
 */

export type MinimaxEmotion = 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';

const MINIMAX_EMOTIONS: MinimaxEmotion[] = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'];

/**
 * v12.363:词表按 owner 真实数据重写。
 *
 * **原来的问题不是误判,是漏判。** 拿 223 个有情绪标注的真实镜头跑一遍旧词表:
 *   neutral 171 镜(77%),其中 **141 镜(63%)是「本有情绪、却退化成 neutral」** ——
 *   `毛骨悚然` / `寒意彻骨` / `释然` / `挣扎` / `暗涌` / `碾压式的胜利` 全部落空。
 * 这个模块的立意是「让 speech-2.8-hd 的情感表达真正接通」,实际只接通了 37%。
 *
 * 两处改动:
 * ① 词表按真实取值大幅补全(编剧写的是「毛骨悚然」不是「恐惧」)。
 * ② **区分「判定为中性」与「判不出」** —— 旧实现两者都返回 neutral,静默且不可观测。
 *    `classifyEmotion` 现在返回 `matched`,调用方能知道到底是哪一种。
 *
 * 顺序有意:复合情绪(「坚定与恐惧交织」)按**强度优先**匹配,恐惧/愤怒先于中性。
 */
const RULES: Array<{ re: RegExp; tag: MinimaxEmotion }> = [
  // 恐惧 —— 编剧最常用的一档,旧词表漏得最多
  { re: /惧|怕|恐|畏|胆怯|不安|紧张|慌|悚|毛骨|寒意|发怵|战栗|颤栗|胆寒|心悸|警觉|警惕|窒息|压迫|危机|不祥|阴森|骇/, tag: 'fearful' },
  // 悲伤
  { re: /悲|哭|难过|委屈|凄|哀|落寞|失落|痛|沉重|酸楚|怅然|黯然|无奈|绝望|孤寂|寂寥|悔|遗憾|苦涩|心酸|苍凉|哽咽|泪/, tag: 'sad' },
  // 愤怒
  { re: /怒|愤|暴|恼|气愤|狂躁|恨|杀意|戾|狠|咬牙|忍无可忍|爆发|敌意|不甘|憋屈|火气|火大/, tag: 'angry' },
  // 惊讶
  { re: /惊|讶|震惊|意外|吃惊|愕|错愕|愣|怔|难以置信|不敢相信|震撼/, tag: 'surprised' },
  // 厌恶
  { re: /厌|嫌|反感|鄙|嫌弃|反胃|作呕|不屑|轻蔑|唾弃|恶心/, tag: 'disgusted' },
  // 喜悦 —— 含「释然/欣慰/胜利/希望」等编剧实际写法
  { re: /喜|笑|兴奋|激动|欢|开心|愉|欣|雀跃|亢奋|甜|释然|欣慰|轻松|温暖|温馨|甜蜜|满足|骄傲|自豪|胜利|希望|期待|憧憬|悸动|心动/, tag: 'happy' },
  // 明确的中性
  { re: /平静|冷静|中性|沉稳|镇定|淡然|平淡|克制|内敛/, tag: 'neutral' },
  // 「决绝/坚定」这类**有强度但无正负价**的情绪:TTS 上按中性念更稳,
  // 但它是**判定出来的中性**,不是判不出 —— 靠 matched 区分。
  { re: /决绝|决断|决心|坚定|果断|笃定|义无反顾|毅然/, tag: 'neutral' },
];

/**
 * v12.363:带「是否判得出」的分类。
 *
 * 旧实现里「判定为中性」和「判不出」都返回 `neutral`,**调用方无从区分**,
 * 于是 63% 的镜头静默退化、没人知道。现在把这件事变成可观测的。
 */
export function classifyEmotion(emotion?: string | null): { emotion: MinimaxEmotion; matched: boolean } {
  const raw = (emotion || '').trim();
  if (!raw) return { emotion: 'neutral', matched: false };
  const e = raw.toLowerCase();
  if ((MINIMAX_EMOTIONS as string[]).includes(e)) return { emotion: e as MinimaxEmotion, matched: true };
  for (const { re, tag } of RULES) if (re.test(raw)) return { emotion: tag, matched: true };
  return { emotion: 'neutral', matched: false };
}

/** 中文/英文情绪词 → MiniMax emotion 枚举;命中枚举原样返回;无法识别 → neutral。 */
export function emotionToMinimaxEmotion(emotion?: string | null): MinimaxEmotion {
  const e = (emotion || '').trim().toLowerCase();
  if (!e) return 'neutral';
  if ((MINIMAX_EMOTIONS as string[]).includes(e)) return e as MinimaxEmotion;
  for (const { re, tag } of RULES) if (re.test(emotion || '')) return tag;
  return 'neutral';
}

/** 分镜 emotionTag 枚举(与 MinimaxEmotion 同集,供剧本 schema/前端选择器复用)。 */
export const EMOTION_TAGS = MINIMAX_EMOTIONS;
