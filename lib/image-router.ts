/**
 * v2.20 P0.3 — Image generation routing decision.
 *
 * 问题: 之前 generateImage 不管几张 refs 都走 MJ 优先, 但 MJ 只能吃 --cref + --sref
 * = 2 张. 当我们有 4-5 张 refs (Style Bible + 主角 + 配角 + 场景 + 历史镜头) 时,
 * MJ 强行只用 2 张, 其他被丢. 结果: 看似有多图参考, 实际只锁了角色 + 风格 2 个维度.
 *
 * 解法: 按 refs 数量 + 用例分路:
 *   - 0 refs → MJ (画质最佳, 无 ref 也没浪费)
 *   - 1-2 refs → MJ (cref/sref 足够)
 *   - 3+ refs → Minimax image-01 multi-ref (subject_reference[]) — 真正用上多图
 *     - 如果 Minimax 失败, fallback 回 MJ (只用前 2 张)
 *   - 总是兜底 → flux.1-kontext-pro (refs 都作 prompt text hint)
 *
 * 这个 lib 只负责"决定走哪个", 实际调用在 orchestrator.generateImage 里.
 * 决策纯函数, 好测.
 */

export type ImageEngine = 'mj' | 'minimax-multi' | 'minimax-single' | 'kontext' | 'seedream' | 'falflux'; // v12.109 seedream / v12.133 falflux(参考图原生)

export interface ImageRouteDecision {
  primary: ImageEngine;
  fallbacks: ImageEngine[];
  reason: string;
}

export interface ImageRouteInput {
  /** cref + sref + referenceImages 拼成的去重 http URL 数组 */
  validRefs: string[];
  /** MJ 是否可用 (有 key + service) */
  mjAvailable: boolean;
  /** Minimax image-01 是否可用 */
  minimaxAvailable: boolean;
  /** kontext 是否可用 (vectorengine 或 qingyuntop) */
  kontextAvailable: boolean;
}

/**
 * 决定 image 生成走哪条路.
 *
 * 优先级矩阵:
 *
 * | refs | MJ | Minimax | kontext | 决策                                            |
 * |------|----|---------|---------|------------------------------------------------|
 * | 0    | ✓  | -       | -       | mj → minimax-single → kontext                   |
 * | 1-2  | ✓  | -       | -       | mj (cref+sref 够) → minimax-single → kontext    |
 * | ≥3   | ✓  | ✓       | -       | minimax-multi → mj (degrade) → kontext          |
 * | ≥3   | ✓  | ✗       | -       | mj (退化到 2 ref) → kontext                     |
 * | ≥3   | ✗  | ✓       | -       | minimax-multi → kontext                         |
 */
/**
 * v12.133(issue #2 Bug A):把 fal.ai FLUX Kontext(falFluxService)提升为**一等参考图引擎**。
 *
 * 病根:此前 falFlux 只在整条 engineChain 全炸后才作深兜底,于是有参考图的镜**总是先撞**
 * 不认参考图的路径 —— minimax-single(丢 refs)、网关 kontext(把参考图当 prompt 文本,模型看不到图)。
 * falFlux 原生用 image_url/image_urls 传真图,是最该优先的参考图引擎。本函数(纯,像 appendSeedreamTier)
 * 在有参考图 + falFlux 可用时,把 falflux 插到 kontext/minimax-single 之前;MJ(原生 cref/sref)/
 * minimax-multi(原生多参)保留主位,falflux 紧随其后。0 参考图不插(那时 mj/seedream 画质更优)。
 */
export function preferFalFluxForRefs(
  route: { primary: ImageEngine; fallbacks: ImageEngine[]; reason: string },
  refCount: number,
  falAvailable: boolean,
): { primary: ImageEngine; fallbacks: ImageEngine[]; reason: string } {
  if (!falAvailable || refCount < 1) return route;
  const chain = [route.primary, ...route.fallbacks].filter((e) => e !== 'falflux');
  const nativeRefPrimary = new Set<ImageEngine>(['mj', 'minimax-multi']);
  const merged: ImageEngine[] = nativeRefPrimary.has(chain[0])
    ? [chain[0], 'falflux', ...chain.slice(1)]                 // 原生多参主位保留,falflux 紧随
    : ['falflux', ...chain];                                   // 主位本是丢/文本 refs 的引擎 → falflux 上位
  const seen = new Set<ImageEngine>();
  const dedup = merged.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));
  return { primary: dedup[0], fallbacks: dedup.slice(1), reason: `${route.reason} +falflux(参考图原生)` };
}

/** v12.109:seedream 档(qingyuntop images/generations 实测 14s 出图,竖屏直出)追加到链尾。 */
export function appendSeedreamTier(route: { primary: ImageEngine; fallbacks: ImageEngine[]; reason: string }): typeof route {
  if (process.env.IMAGE_SEEDREAM_DISABLE === '1') return route;
  if (route.primary !== 'seedream' && !route.fallbacks.includes('seedream')) route.fallbacks = [...route.fallbacks, 'seedream'];
  return route;
}

export function decideImageRoute(input: ImageRouteInput): ImageRouteDecision {
  const refCount = input.validRefs.length;

  const allEngines = (): ImageEngine[] => {
    const out: ImageEngine[] = [];
    if (input.mjAvailable) out.push('mj');
    if (input.minimaxAvailable) out.push('minimax-single');
    if (input.kontextAvailable) out.push('kontext');
    return out;
  };

  // 0 refs — MJ 画质优势最大, 直接走
  if (refCount === 0) {
    const order = allEngines();
    if (order.length === 0) {
      return { primary: 'kontext', fallbacks: [], reason: 'no engine available, last-resort kontext' };
    }
    return { primary: order[0], fallbacks: order.slice(1), reason: `0 refs, prefer ${order[0]} for quality` };
  }

  // 1-2 refs — MJ cref+sref 设计就吃 2 张, 完全够
  if (refCount <= 2) {
    if (input.mjAvailable) {
      const fallbacks: ImageEngine[] = [];
      if (input.minimaxAvailable) fallbacks.push('minimax-single');
      if (input.kontextAvailable) fallbacks.push('kontext');
      return { primary: 'mj', fallbacks, reason: `${refCount} ref(s), MJ cref/sref native fit` };
    }
    if (input.minimaxAvailable) {
      return {
        primary: 'minimax-single',
        fallbacks: input.kontextAvailable ? ['kontext'] : [],
        reason: `${refCount} ref(s), MJ unavailable, fallback minimax`,
      };
    }
    return { primary: 'kontext', fallbacks: [], reason: 'only kontext available' };
  }

  // ≥3 refs — 关键改进点: 走 Minimax multi-ref 才能真正用上所有图
  if (input.minimaxAvailable) {
    const fallbacks: ImageEngine[] = [];
    if (input.mjAvailable) fallbacks.push('mj'); // MJ 退化到 2 ref 仍然能跑
    if (input.kontextAvailable) fallbacks.push('kontext');
    return {
      primary: 'minimax-multi',
      fallbacks,
      reason: `${refCount} refs, minimax-multi can use all (MJ would drop ${refCount - 2})`,
    };
  }

  // Minimax 不可用时, 接受 MJ 的退化 — 总比放弃 refs 强
  if (input.mjAvailable) {
    return {
      primary: 'mj',
      fallbacks: input.kontextAvailable ? ['kontext'] : [],
      reason: `${refCount} refs, minimax unavailable, MJ will use first 2`,
    };
  }

  return { primary: 'kontext', fallbacks: [], reason: 'fallback to kontext' };
}

/**
 * 从 cref / sref / referenceImages 三个入口拼成去重 + 仅 http(s) 的 refs 数组.
 * 保留顺序: cref → sref → referenceImages (但同 URL 已在前面就跳后面).
 */
export function collectValidRefs(opts: {
  cref?: string;
  sref?: string;
  referenceImages?: string[];
  /** v12.463:也收内联图(本地存储下的草图)—— 由各引擎按 refsForEngine 自己取认得的那部分 */
  allowInline?: boolean;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u?: string) => {
    if (typeof u !== 'string' || seen.has(u)) return;
    if (!u.startsWith('http') && !(opts.allowInline && isInlineImage(u))) return;
    seen.add(u);
    out.push(u);
  };
  push(opts.cref);
  push(opts.sref);
  if (Array.isArray(opts.referenceImages)) {
    for (const u of opts.referenceImages) push(u);
  }
  return out;
}

/**
 * v12.463 · 内联图(`data:image/…;base64,…`)。
 *
 * 本地存储部署下,站内图(`/api/serve-file?…`)引擎够不着,`lib/first-frame` 的 toEngineImage 把它转成内联图。
 * 而出图链路各处只放行 http 参考图 —— 于是**草图锁的草图在本地部署下从没送到过引擎**
 * (导演台渲的布局草图天生是本地文件;v12.347 起 AI 画的、上传的草图也落到本地),
 * 提示词却照样追加「Strictly follow … the provided reference storyboard sketch」。
 */
export const isInlineImage = (u: unknown): u is string =>
  typeof u === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(u);

/** MiniMax 官方上限 10MB;base64 膨胀 4/3,折成字符数(布局草图只有几十 KB,远在其下) */
export const INLINE_IMAGE_MAX_CHARS = Math.floor((10 * 1024 * 1024 * 4) / 3);

/**
 * 认得内联图的引擎 —— **只收官方文档写明支持的**(2026-10-01 逐家核对原页面):
 *  - MiniMax image-01 `subject_reference[].image_file`:「支持公网 URL 或 Base64 编码的 Data URL」,< 10MB
 *    https://platform.minimax.cn/docs/api-reference/image-generation-i2i (v12.465 真调:修好字段格式后出图成功)
 *  - fal.ai:「You can pass a Base64 data URI as a file input. The API will handle the file decoding for you.」
 *    https://fal.ai/models/fal-ai/flux-pro/kontext/api
 *  - Seedream(v12.465 加):火山方舟「image … 支持 URL 或 Base64 编码 … data:image/<图片格式>;base64,<Base64 编码>」,单张 ≤ 30MB
 *    https://docs.volcengine.com/docs/ark/image-generation-api 。经网关转发 `image` 字段已由 v12.148 实测(输出跟随参考图尺寸);
 *    网关收不收 base64 **没真调验证**(v12.465 撞上网关额度耗尽)—— 网关拒了由 seedream 档自己退回纯文生图。
 * 不在表里的:MJ(cref/sref 只认公网图;草图另走垫图,见 sketchEnginesFor)、网关 kontext(参考图只作提示词文本 ——
 * 内联图塞进去会把提示词撑爆;网关文档查不到,真调撞上上游负载饱和)。
 */
export const INLINE_REF_ENGINES: ReadonlySet<ImageEngine> = new Set<ImageEngine>(['minimax-multi', 'minimax-single', 'falflux', 'seedream']);

/**
 * v12.465:能把**草图当构图参考**用的引擎 —— 与「收不收内联图」是两回事。
 *  - **MiniMax 不在内**:它收图只当人物参考(官方:「主体类型,当前仅支持 character(人像)」)。
 *    真调:同一张草图(左下近处大人、右上远处小人)送 MiniMax,出图是两人并排站在画面正中 —— 构图没跟。
 *    v12.463 把草图优先送 MiniMax 是错的(当时请求格式还有错,每次 2013 被拒,所以没暴露)。
 *  - fal Kontext:编辑输入图本身,结构跟得最紧;Seedream:参考图生图。
 *  - MJ:草图作垫图(图像提示,构图与色调一起参考,灰块草图可能把画面带灰)—— 未真调验证(网关当时无 MJ 渠道),
 *    默认关,`MJ_SKETCH_IMAGE_PROMPT=1` 开;
 *  - 网关 kontext:沿用 `KONTEXT_GATEWAY_IMAGE_INPUT=1`,且只收公网图。
 */
/**
 * 去掉草图锁那句(`storyboard-sketch.buildSketchDirective` 追加的单行 ` [STORYBOARD LOCK] …`)——
 * 给没拿到草图的引擎:提示词说「按提供的草图」而图根本没给,只会让模型去猜(v12.465)。
 */
export const stripSketchLock = (prompt: string): string => prompt.replace(/ \[STORYBOARD LOCK\][^\n]*/, '');

export function sketchEnginesFor(sketch: string, env: NodeJS.ProcessEnv = process.env): ImageEngine[] {
  const out: ImageEngine[] = ['falflux'];
  if (env.SEEDREAM_I2I_DISABLE !== '1' && env.IMAGE_SEEDREAM_DISABLE !== '1') out.push('seedream');
  if (env.MJ_SKETCH_IMAGE_PROMPT === '1') out.push('mj');
  if (sketch.startsWith('http') && env.KONTEXT_GATEWAY_IMAGE_INPUT === '1') out.push('kontext');
  return out;
}

/** 给某个引擎的参考图:http 照给;内联图只给认得它的引擎,且不超上限 */
export function refsForEngine(refs: ReadonlyArray<string | null | undefined> | undefined, engine: ImageEngine): string[] {
  const inlineOk = INLINE_REF_ENGINES.has(engine);
  return (refs || []).filter((u): u is string =>
    typeof u === 'string' && (u.startsWith('http') || (inlineOk && isInlineImage(u) && u.length <= INLINE_IMAGE_MAX_CHARS)));
}

/**
 * 把「收得到这批参考图」的引擎排到最前。否则按参考图数量的老规矩,1–2 张会先给 MJ ——
 * MJ 只看 cref/sref,草图被静默丢掉,出图「成功」而构图没锁住。
 *  - 有草图(sketchEngines 非空,即 storyboard-sketch.sketchTargets 的结果):能按草图构图的引擎在前(v12.465);
 *  - 否则参考图里有内联图:认得内联图的引擎在前(v12.463)。
 * 链里没有这类引擎就原样返回。
 */
export function preferInlineRefEngines(route: ImageRouteDecision, hasInline: boolean, sketchEngines?: readonly ImageEngine[]): ImageRouteDecision {
  const want: ReadonlySet<ImageEngine> | null = sketchEngines?.length ? new Set(sketchEngines) : hasInline ? INLINE_REF_ENGINES : null;
  if (!want) return route;
  const chain = [route.primary, ...route.fallbacks];
  const capable = chain.filter((e) => want.has(e));
  if (capable.length === 0 || capable[0] === chain[0]) return route;
  const ordered = [...capable, ...chain.filter((e) => !want.has(e))];
  const why = sketchEngines?.length ? 'storyboard sketch' : 'inline image';
  return { primary: ordered[0], fallbacks: ordered.slice(1), reason: `${route.reason}; ${why} → ${ordered[0]} first (it can use it)` };
}
