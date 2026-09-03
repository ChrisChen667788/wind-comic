/**
 * lib/text-in-frame.ts — 画面里要出现汉字时,该走哪条路(v12.416)。
 *
 * ── 病象:libass 字幕 ≠ 帧内文字 ──────────────────────────────────────
 * 本轮竞品复核把这条列为**最实的一个缺口**。我们有 libass 中文字幕烧录 ——
 * 但那是**后期叠加**:一层贴在成片上的字。而短剧/漫剧真正需要的是
 * **生成层的帧内文字**:片头字卡、对白框、招牌、书信、弹幕体标题……
 * 这些字得长在画面里、跟着透视和光线走,叠一层字幕替代不了。
 *
 * 而通用图像模型画汉字基本是乱码 —— 它不报错,就是画出一堆像汉字的鬼画符。
 * 又一个「失败长得像成功」:出图成功了,只是字不对。
 *
 * 竞品侧已经有成熟方案(Seedream 5.0 的 Glyph-Aligned ByT5、Qwen-Image 2.0),
 * 而我们的 `seedream` 档一直只是普通图像兜底,**从没因为「这镜要写字」被选中过**。
 *
 * ── 一条刻意的诚实 ────────────────────────────────────────────────────
 * 没有配置擅长写字的引擎时,**不硬画** —— 明确回落到 libass 叠字并说明原因。
 * 让通用模型去画汉字,产出的是看起来对、其实是乱码的图;
 * 那比「叠一层字幕」更糟,因为它不会被任何人发现。
 */

/** 擅长帧内文字渲染的引擎(按能力排序)。 */
export const GLYPH_CAPABLE_ENGINES = ['seedream', 'qwen-image'] as const;
export type GlyphEngine = (typeof GLYPH_CAPABLE_ENGINES)[number];

/** 需要帧内文字的镜头类型 —— 这些是短剧里真的会出现的形态。 */
export type TextInFrameKind = 'title-card' | 'dialogue-box' | 'signage' | 'letter' | 'none';

const KIND_HINTS: Array<{ kind: Exclude<TextInFrameKind, 'none'>; re: RegExp }> = [
  { kind: 'title-card', re: /片头|标题卡|字卡|开场标题|title card/i },
  { kind: 'dialogue-box', re: /对白框|对话框|气泡|漫画框|speech bubble/i },
  { kind: 'signage', re: /招牌|门牌|路牌|横幅|店名|signage|banner/i },
  { kind: 'letter', re: /信件|书信|纸条|短信|屏幕文字|letter|note/i },
];

export interface TextInFrameNeed {
  kind: TextInFrameKind;
  /** 要画出来的确切文字 —— 没有它就没法验证画对没有 */
  text: string;
}

/**
 * 这一镜要不要在画面里写字。
 * **必须有确切文字**才算数:没有确切文字就无从验证画对没有,
 * 那就退化成「让模型自由发挥写点像字的东西」—— 那正是乱码的来源。
 */
export function detectTextInFrame(input: {
  shotType?: string;
  description?: string;
  onScreenText?: string;
}): TextInFrameNeed {
  const text = (input.onScreenText || '').trim();
  if (!text) return { kind: 'none', text: '' };

  const haystack = `${input.shotType || ''} ${input.description || ''}`;
  for (const h of KIND_HINTS) {
    if (h.re.test(haystack)) return { kind: h.kind, text };
  }
  // 有确切文字但认不出形态 —— 仍按字卡处理(总比乱码强)
  return { kind: 'title-card', text };
}

export interface TextRouteDecision {
  /** 用哪个引擎;null = 没有擅长写字的引擎可用 */
  engine: GlyphEngine | null;
  /** 是否回落到 libass 后期叠字 */
  fallbackToOverlay: boolean;
  reason: string;
  /** 给图像引擎的补充提示(仅 engine 非 null 时有意义) */
  promptSuffix?: string;
}

export function routeTextInFrame(
  need: TextInFrameNeed,
  availableEngines: readonly string[],
): TextRouteDecision {
  if (need.kind === 'none') {
    return { engine: null, fallbackToOverlay: false, reason: '这一镜不需要帧内文字' };
  }

  const pick = GLYPH_CAPABLE_ENGINES.find((e) => availableEngines.includes(e));
  if (!pick) {
    // 不硬画:让通用模型画汉字,出来的是看起来对、其实是乱码的图,
    // 而且不会被任何人发现 —— 比叠一层字幕更糟。
    return {
      engine: null,
      fallbackToOverlay: true,
      reason:
        '没有擅长帧内文字的引擎(Seedream / Qwen-Image)可用 —— ' +
        '回落到 libass 后期叠字。**不让通用模型硬画汉字**:它不会报错,' +
        '只会画出一堆像汉字的鬼画符,而这种失败长得像成功。',
    };
  }

  return {
    engine: pick,
    fallbackToOverlay: false,
    reason: `帧内文字(${need.kind})交给 ${pick} —— 它有字形对齐能力`,
    promptSuffix: buildGlyphPrompt(need),
  };
}

/** 把「要写什么字」说清楚。刻意用引号包住,避免模型把它当成场景描述的一部分。 */
export function buildGlyphPrompt(need: TextInFrameNeed): string {
  const where: Record<Exclude<TextInFrameKind, 'none'>, string> = {
    'title-card': '画面中央的标题卡上',
    'dialogue-box': '漫画对白框内',
    signage: '场景中的招牌/门牌上',
    letter: '画面中的信纸/屏幕上',
  };
  const place = where[need.kind as Exclude<TextInFrameKind, 'none'>];
  return (
    `${place}清晰渲染这几个汉字:「${need.text}」。` +
    '字形必须准确可读、笔画完整,随画面透视与光线自然融入;不要生造字、不要变形。'
  );
}
