/**
 * v2.20 P0.1 — Style Bible Frame
 *
 * 问题: 之前每个 shot 独立生成, MJ/Flux 看到的"风格"只有一段文字 +
 * 最近 2 张图. 6 个 shot 看起来像 6 部不同的剧, 因为每个 shot 都在
 * 重新协商 "what does cinematic mean".
 *
 * 解法: Director plan 拿到后, 立刻渲染 1 张 canonical "key art" 帧 —
 * 把 styleKeywords / genre / 主题情绪 全部凝固成一张视觉锚点. 然后:
 *   - 这张图作为后续 Character Designer / Scene Designer / Storyboard
 *     每一次 generateImage 的第 1 张 sref
 *   - MJ/Flux/Minimax 不再"猜风格", 它们看到的是"必须长得像这张"
 *   - 整片画风 drift 接近 0
 *
 * 设计原则:
 *   - 不依赖 character/scene 已经存在 (Style Bible 先于它们生成)
 *   - prompt 只描述 "look + mood + grade", 不描述具体主体 (避免被误以为是具体场景)
 *   - 失败 fallback: styleAnchorImageUrl 留空, 后续路径走老的 styleKeywords 文本
 *     (degraded but no crash)
 */

export interface StyleBibleInput {
  /** Director plan 给的 styleKeywords, 例如 "cinematic 3D Chinese animation, octane render" */
  styleKeywords: string;
  /** 题材, 用于推导画面气氛 — 古装 / 赛博 / 现代 / 武侠 / 校园 ... */
  genre?: string;
  /** Director plan 的 hookStrategy / dominant emotion / synopsis 任一可作 mood 线索 */
  moodHint?: string;
  /** 项目宽高比 — 16:9 横屏 / 9:16 竖屏漫剧 / 1:1 / 2.35:1 */
  aspect?: string;
}

/**
 * 根据 genre 推导出气氛锚词. 这些是"Style Bible 帧" 专用 — 比逐 shot
 * 的 eraConstraint 更宽泛, 强调整体视觉气质 (色温 / 光调 / 颗粒感).
 */
function getMoodWordsForGenre(genre: string): string {
  const g = genre.toLowerCase();
  if (/古装|秦|唐|宋|明|清|朝|宫|侠|武|仙|修|汉服|wuxia|xianxia|dynasty/.test(g)) {
    return 'warm amber lighting, soft volumetric haze, ink-wash painterly grade, jade and crimson palette, low contrast highlights';
  }
  if (/赛博|科幻|未来|cyber|sci-fi|future|mech/.test(g)) {
    return 'neon cyan and magenta bloom, deep teal shadows, anamorphic lens flares, high contrast cinematic grade, wet asphalt highlights';
  }
  if (/恐怖|惊悚|悬疑|horror|thriller|mystery/.test(g)) {
    return 'cold steel-blue shadows, single source key light, hard shadow falloff, desaturated palette, grainy film noise';
  }
  if (/校园|青春|youth|campus|slice/.test(g)) {
    return 'soft golden hour backlight, pastel palette, low contrast film grain, dreamy bokeh, lifted shadows';
  }
  if (/言情|甜宠|romance/.test(g)) {
    return 'warm peach highlights, soft rim light, creamy bokeh, gentle film grain, lifted milk shadows';
  }
  if (/职场|都市|urban|workplace/.test(g)) {
    return 'cool tungsten white balance, sharp practical lighting, glass and steel reflections, balanced cinematic grade';
  }
  if (/民国|1920|1930|republic/.test(g)) {
    return 'sepia warm tones, oil-lamp glow, fine film grain, vintage Kodachrome palette, soft halation around highlights';
  }
  if (/动画|cartoon|kids|童话|fable/.test(g)) {
    return 'saturated primary colors, soft cel-shading, even diffuse lighting, clean line work, no grain';
  }
  // 默认
  return 'balanced cinematic grade, natural lighting, controlled contrast, fine film grain';
}

/**
 * 构造 Style Bible 帧的 image gen prompt.
 *
 * 不指向任何具体角色/场景 — 这是抽象的 "look bible" 帧, 用海报 / mood board 的
 * 视觉语言: 单帧里能凝固住整片的色彩 / 光调 / 颗粒 / 笔触.
 */
export function buildStyleBiblePrompt(input: StyleBibleInput): string {
  const style = (input.styleKeywords || '').trim() || 'cinematic, 35mm, professional cinematography';
  const moodWords = getMoodWordsForGenre(input.genre || '');
  const aspect = normalizeAspect(input.aspect);
  const moodHint = (input.moodHint || '').trim().slice(0, 80);

  const parts: string[] = [
    'cinematic key art poster, single canonical look frame',
    style,
    moodWords,
  ];
  if (moodHint) {
    parts.push(`overall mood: ${moodHint}`);
  }
  parts.push(
    'establishing wide composition, atmospheric depth, foreground midground background separation',
    'no specific characters, no faces, no body figures, environmental abstract composition',
    'matte painting quality, controlled palette, consistent rendering language',
    'this frame defines the visual identity for the entire series',
  );

  return `${parts.join(', ')} --ar ${aspect} --s 250 --no people --no person --no character --no face`;
}

/**
 * 接受输入的 aspect string, 归一化到 MJ 支持的格式. 不识别就返回 16:9.
 */
export function normalizeAspect(aspect?: string): string {
  if (!aspect) return '16:9';
  const a = String(aspect).trim();
  if (/^\d+:\d+$/.test(a)) return a;
  // tolerate other formats
  if (a === 'vertical' || a === '9x16' || a === '9-16') return '9:16';
  if (a === 'square' || a === '1x1') return '1:1';
  if (a === 'wide' || a === 'cinema' || a === 'cinematic') return '2.35:1';
  return '16:9';
}

/**
 * 把 Style Bible 图 URL 安全地注入到 progressiveRefs 数组的开头.
 *
 * 规则:
 *   - 仅接受 http(s) URL — data:/svg/mock 不能传给远端 image API
 *   - 已经在数组里就不重复加 (dedup)
 *   - 返回的新数组永远以 styleAnchor 作首项 (作 --sref)
 */
export function prependStyleAnchor(
  styleAnchorUrl: string | undefined,
  refs: string[],
): string[] {
  if (!styleAnchorUrl || !styleAnchorUrl.startsWith('http')) return refs;
  if (refs[0] === styleAnchorUrl) return refs;
  const filtered = refs.filter((u) => u !== styleAnchorUrl);
  return [styleAnchorUrl, ...filtered];
}
