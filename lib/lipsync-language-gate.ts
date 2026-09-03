/**
 * lib/lipsync-language-gate.ts — ja/ko/ru 到底能不能有口型(v12.418)。
 *
 * ── 现状:这三种语言的成片完全没有口型 ────────────────────────────────
 * `lib/language-detect.ts` 里 ja / ko / ru 的 `lipsync` 是 `'none'`。
 * v12.179 / v12.196 的注释解释过为什么:口型引擎只有 zh/en 的音素表,
 * 拿 en viseme 去驱动日语会**口型与发音严重错位**,而「错口型比无口型更伤观感」。
 *
 * 那个判断到今天依然对 —— **但它是受限于当时的引擎**。
 * 本轮复核顺带纠正了一个流传的数字:可灵口型是 **5 种语言**,不是坊间说的 20+
 * (20+ 是 HeyGen 的数据被张冠李戴)。而 Sync.so 的 lipsync-2 是 **language-agnostic** 的:
 * 它对齐的是音频波形与嘴形,不依赖某种语言的音素表。
 *
 * 所以「有没有口型」不再只由语言决定,而是 **语言 × 当前装了什么引擎**。
 *
 * ── 为什么单独一个模块,而不是改 lipsyncLangCode ──────────────────────
 * `lipsyncLangCode` 是**纯语言表**:给定语言返回音素代号,不该知道部署里装了什么。
 * 把 env 探测塞进去,它就从一张表变成了有环境依赖的函数,
 * 而它有 5 个调用方 —— 那正是「同一语义两份实现」的温床。
 * 这里只做一件事:回答「这个语种在**当前部署下**能不能上口型」。
 *
 * ── 一条刻意的保守 ────────────────────────────────────────────────────
 * 只有装了**语种无关**引擎才解开。自托管的 `wav2lip-http` 不算 ——
 * 它背后可能是 wav2lip/SadTalker/MuseTalk 任意一种,我们无从知道它对日语行不行;
 * 拿「可能行」去换「错口型」,是拿观感赌运气。宁可继续诚实降级。
 */
import { lipsyncLangCode, type TargetLanguage } from './language-detect';

/**
 * 语种无关的口型引擎 —— 它们对齐音频波形与嘴形,不依赖音素表,任何语言都能对。
 * 加新引擎时**必须确认它真的是 language-agnostic** 才能进这张表:
 * 进错一个,ja/ko/ru 就会拿到错口型,而那比没有口型更伤。
 *
 * 注:`kling` 不在此列 —— 本轮复核纠正了一个流传的数字,可灵口型是 **5 种语言**,
 * 不是坊间说的 20+(20+ 是 HeyGen 的数据被张冠李戴)。
 * 自托管的 `wav2lip-http` 也不在此列:它背后可能是 wav2lip/SadTalker/MuseTalk 任意一种,
 * 我们无从知道它对日语行不行 —— 拿「可能行」去换「错口型」,是拿观感赌运气。
 */
export const LANGUAGE_AGNOSTIC_LIPSYNC = ['syncso'] as const;

/**
 * 当前部署是否装了语种无关引擎(只看 env,不做 I/O —— 调用方在选链时同步调)。
 * 用的是 `SYNCSO_API_KEY` —— 与 `services/lipsync-providers.ts` 里那份**已存在的**
 * Sync.so 适配器同一把钥匙。(写这一版时我差点新建第三份 Sync.so 实现,
 * 幸好先 grep 了一遍:主管线用的是 services/ 那套,lib/lipsync-providers/ 是另一套。)
 */
export function hasLanguageAgnosticLipsync(): boolean {
  const k = process.env.SYNCSO_API_KEY || '';
  return !!k && !k.startsWith('your_');
}

export interface LipsyncLangDecision {
  /** 能不能上口型 */
  enabled: boolean;
  /** 传给引擎的语言代号;语种无关引擎用 'any' */
  langCode: 'zh' | 'en' | 'any';
  /** 直接可写进日志/UI 的说明 */
  reason: string;
}

/**
 * 这个语种在当前部署下能不能上口型。
 *
 * · zh/en 一直可以(有音素表);
 * · es/fr/de/pt 映射到 en(拉丁语系音素足够近,历史行为不变);
 * · ja/ko/ru 只有在装了语种无关引擎时才解开 —— 否则继续诚实降级。
 */
export function decideLipsyncForLanguage(lang: TargetLanguage): LipsyncLangDecision {
  const code = lipsyncLangCode(lang);

  if (code !== 'none') {
    return { enabled: true, langCode: code, reason: `${code} 音素表可用` };
  }

  if (hasLanguageAgnosticLipsync()) {
    return {
      enabled: true,
      langCode: 'any',
      reason:
        `${lang} 无音素表,但已配置语种无关引擎(${LANGUAGE_AGNOSTIC_LIPSYNC.join('/')})——` +
        '它对齐的是音频波形与嘴形,不依赖音素表,故可上口型',
    };
  }

  return {
    enabled: false,
    langCode: 'any',
    reason:
      `${lang} 无适配音素表,且未配置语种无关引擎 —— 跳过口型(诚实降级)。` +
      '拿 en viseme 驱动会口型-发音严重错位,**错口型比无口型更伤观感**。' +
      '配 SYNCSO_API_KEY 即可解开这三种语言。',
  };
}
