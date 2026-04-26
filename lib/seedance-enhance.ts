/**
 * Seedance 2.0-inspired prompt & reference enhancers
 *
 * 背景:
 *   ByteDance Seedance 2.0 (2026-02 发布) 在角色/场景一致性上做到业内最佳,核心手段:
 *     1. Multi-reference input: 单次生成最多 9 张参考图 + 3 段视频 + 3 段音频
 *     2. Multi-lens storytelling: 一次请求生成多机位同场景
 *     3. 面部/服饰/配饰/文字/场景全维度锁定 (character consistency across faces,
 *        clothing, accessories, text, scenes)
 *     4. 统一架构: composition / motion / camera / audio 协同生成
 *
 * 我们能借鉴的部分:
 *   - 多参考图渐进链 (progressive refs): 角色图 + 风格图 + 前序场景图 同时注入
 *   - 一致性锚点词 (consistency anchors): face geometry / palette / silhouette
 *     / lighting scheme 作为显式 prompt 片段,跨镜头复用
 *   - 多机位语法: 角色设计时预先描述"front / three-quarter / profile / back"
 *     四机位,给后续镜头建立 3D 心智模型
 *   - 风格传递链 (style cascade): 场景 N 的参考图包含场景 N-1 的产出,让画风
 *     连续演化而不是各自为战
 *
 * 注意 - 我们用的是 MJ / flux.1-kontext-pro / Minimax image-01,底层能力不如 Seedance
 * 2.0,所以这里做的是 prompt 层的"软一致性",不是模型层的"硬一致性"。
 */

/**
 * 为角色三视图注入 Seedance 风格的一致性锚点词。
 * 核心: 把角色描述改写成"多机位 turnaround sheet",并显式标出 5 类锚点:
 *   face / hair / outfit / silhouette / signature props
 * 目的是让模型在 512px 内就给出稳定的 ID,后续 --cref 引用时不会漂移。
 */
export function enhanceCharacterPromptSeedance(basePrompt: string, charName: string): string {
  const seedanceAnchors = [
    'character turnaround sheet with 4 synchronized views (front / three-quarter left / profile / back)',
    'consistent facial geometry across all views, same eye shape same nose bridge same jawline',
    'identical hair style and volume in every view',
    'identical outfit and accessories in every view, same color palette',
    'unified silhouette identity, instantly recognizable from shadow alone',
    'signature visual anchors locked: face, hair, clothing, props',
    'neutral studio lighting, even illumination, no dramatic shadows to preserve identity features',
    'clean white background, no distracting elements',
  ].join(', ');

  return `${basePrompt}. Character identity lock: ${charName}. ${seedanceAnchors}`;
}

/**
 * 为场景概念图注入 Seedance 风格的"多机位预演"语言。
 * 给模型一个信号: 这张场景图后续会从 N 个机位重新观察,
 * 所以要画成"可被多机位复用的通用环境板",而不是某个具体取景。
 */
export function enhanceScenePromptSeedance(basePrompt: string): string {
  const multiLensHints = [
    'environment established shot designed for multi-lens coverage',
    'wide-angle master plate showing full spatial layout',
    'stable lighting scheme locked for this location, reusable across multiple shots',
    'unified color grading anchor for the scene',
    'clear foreground / midground / background separation for later camera blocking',
    'atmospheric depth rendered, matte painting quality',
  ].join(', ');

  return `${basePrompt}. Multi-lens storytelling preparation: ${multiLensHints}`;
}

/**
 * 构造渐进式参考图链 (progressive reference chain)
 *
 * Seedance 2.0 支持 9 张参考图同时输入,让模型同时看到:
 *   [风格基准, 角色参考, 前序场景 x N, 当前主体 sketch]
 *
 * 我们的 flux.1-kontext-pro 最多 4 张、MJ 仅支持 --cref + --sref = 2 张,
 * 所以做"优先级降采样":
 *
 *   优先级 1: styleRef (用户上传的风格样图)
 *   优先级 2: primaryCharRef (主角三视图)
 *   优先级 3: prevSceneRef (上一场景成片,做风格传递)
 *   优先级 4: secondaryCharRef (次角色三视图)
 *
 * 输出前 maxRefs 张,去重 + 过滤掉非 http 的 data URI。
 */
export function buildProgressiveRefs(opts: {
  styleRef?: string;
  primaryCharRef?: string;
  prevSceneRef?: string;
  secondaryCharRef?: string;
  maxRefs?: number;
}): string[] {
  const maxRefs = opts.maxRefs ?? 4;
  const ordered = [opts.styleRef, opts.primaryCharRef, opts.prevSceneRef, opts.secondaryCharRef];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of ordered) {
    if (!url) continue;
    if (!url.startsWith('http')) continue; // data: URI 不能当参考图传给远程 API
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= maxRefs) break;
  }
  return result;
}

/**
 * 风格锚点块 - 跨所有角色/场景共享的强一致性关键词。
 * 在每一张图的 prompt 里复读这段,让画风不随 seed 漂移。
 *
 * 用法: `${basePrompt}. ${STYLE_ANCHOR_BLOCK(styleKeywords)}`
 */
export function styleAnchorBlock(styleKeywords: string): string {
  if (!styleKeywords) return '';
  return [
    `STYLE LOCK: ${styleKeywords}`,
    'maintain identical rendering style across all frames',
    'same brushwork, same line quality, same shading technique',
    'consistent color temperature and saturation throughout the series',
  ].join(', ');
}

/**
 * 多机位规划 (用于分镜/视频阶段)
 * 根据场景和角色,推荐 3-5 个互补机位,对应 Seedance 的 multi-lens storytelling。
 * 返回值供 prompt 注入,不直接生成多张图 (模型能力受限)。
 */
export function planCamerasForShot(opts: {
  shotEmotion?: string;
  hasCharacter: boolean;
  hasScene: boolean;
}): string {
  const lensPlan: string[] = [];

  if (opts.hasCharacter) {
    if (opts.shotEmotion?.match(/紧张|恐惧|惊|突|急|危/)) {
      lensPlan.push('handheld close-up');
      lensPlan.push('dutch angle medium shot');
    } else if (opts.shotEmotion?.match(/壮阔|史诗|宏大|升格/)) {
      lensPlan.push('wide establishing shot');
      lensPlan.push('slow push-in dolly');
    } else {
      lensPlan.push('medium shot eye-level');
      lensPlan.push('three-quarter angle');
    }
  } else if (opts.hasScene) {
    lensPlan.push('wide establishing shot');
    lensPlan.push('atmospheric master plate');
  }

  return lensPlan.length > 0
    ? `multi-lens coverage: ${lensPlan.join(' | ')}`
    : '';
}
