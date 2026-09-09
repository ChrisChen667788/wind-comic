/**
 * 示意图的来源标记(v12.427)。
 *
 * ## 起因
 *
 * 所有图像引擎失败时,orchestrator 返回一张渐变图,**只打一条 console.warn 就当成功返回**。
 * 这张假图一路流下去 —— 落库、被抄成项目封面、进分镜页、进成片,
 * 整条链路没有一环知道「这镜其实没出图」。v12.426 修的项目封面只是它的一个下游:
 * 实测 30 个项目里 12 个的 `cover_urls` 存的就是这种图,而其中 3 个明明各有
 * 11~12 张真分镜还活着 —— 因为没人知道那张封面是假的,也就没人想过要重算。
 *
 * ## 措辞
 *
 * 用户可见一律叫「示意图」:
 *   · 不叫「降级产物」—— 难听,而且读起来像在评价用户的作品;
 *   · 不叫「试拍」—— 本产品里 `试拍 1 镜` 已指「真出一镜给你先看 vibe」,
 *     借这个词会把「真出了一镜」和「一镜都没出成」混成一件事,
 *     这正是本仓最忌讳的那类命名。
 *
 * ## 识别分两层,缺一不可
 *
 *   ① **显式标记** `data.provenance = 'placeholder'` —— 新产物的权威来源;
 *   ② **URL 形态兜底** —— 已落库的历史数据没有标记,只能靠形态认。
 *
 * 只做①,历史数据永远认不出来;只做②,等于让下游去猜生成端发生过什么 ——
 * 而「猜」正是这个 bug 一开始能存在三个月的原因。
 */

/** 落在 `project_assets.data.provenance` 上的值。 */
export const PLACEHOLDER_PROVENANCE = 'placeholder' as const;

/** 用户可见措辞。改这里就改全站 —— 别在组件里各写各的。 */
export const PLACEHOLDER_LABEL = '示意图';
export const PLACEHOLDER_HINT = '引擎未出图,当前显示示意图 —— 重生该镜即可替换';

/**
 * 埋进 SVG 的自述标记。
 *
 * 有了它,URL 本身就能自证「我是示意图」,而不必靠「凡是 data:image/svg 都算」
 * 这种连累无辜的粗判据。历史数据没有这个标记,所以粗判据仍要保留作兜底。
 */
export const PLACEHOLDER_SVG_MARK = 'data-qfmj-placeholder="1"';

/**
 * 造一张示意图。**全仓唯一的一处** ——
 * 此前 services/hybrid-orchestrator.ts:132 与 services/demo-orchestrator.ts:10
 * 各有一份逐字相同的 mockSvg(实测 diff 无差异),典型的「同一语义两份实现」。
 */
export function makePlaceholderImage(opts: {
  width: number;
  height: number;
  label: string;
  colors?: [string, string];
}): string {
  const { width: w, height: h, label } = opts;
  const [c1, c2] = opts.colors ?? ['#1e1b4b', '#7c3aed'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${PLACEHOLDER_SVG_MARK} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="system-ui" font-size="${Math.min(w, h) * 0.07}">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 光看 URL 判断是不是示意图 —— 给**没有显式标记的历史数据**兜底。
 *
 * 三种形态都要认(第一版只认了第一种,漏掉 mock 路由,
 * 绿皮书之约的项目卡因此实拍出一块纯绿色矩形):
 *   · 带自述标记的 data URI(v12.427 起的新产物)
 *   · 任何 `data:image/svg` —— 本应用在「素材位」上从不放内联 SVG,放了就是占位
 *   · `/api/mock-assets/…` —— mock 引擎的确定性产物服务
 */
export function isPlaceholderUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes(encodeURIComponent(PLACEHOLDER_SVG_MARK))) return true;
  if (url.startsWith('data:image/svg')) return true;
  return /(^|\/\/[^/]*)\/api\/mock-assets\//.test(url);
}

/** 资产行(只取本模块用得到的字段,避免和各处的 Asset 类型耦合)。 */
export interface PlaceholderCheckable {
  /**
   * 服务端已经判好的结论。**优先级最高。**
   *
   * 为什么需要它:normalizeAssetRow 会把 mediaUrls[0] 换成 persistentUrl
   * (理由正当 —— 外链会 404,持久化文件一定打得开),但副作用是**历史 mock 的证据
   * 在出接口那一刻就被抹掉了**:原始行里 media_urls 是 /api/mock-assets/…,
   * 出到客户端只剩 /api/serve-file?key=…,看不出任何异常。
   * 实测绿皮书之约:库里 8 张 mock 分镜,接口出去后客户端一张也认不出来。
   * 所以由服务端在**原始行**上判完带出来,而不是让客户端从失真数据里倒推。
   */
  isPlaceholder?: boolean;
  /**
   * 可能是**对象**(接口层已解析),也可能是**JSON 字符串**(直接从库里 SELECT 出来的原始行)。
   * 两种都要认:导出路径走 listAssetsByType,拿到的就是字符串那种 ——
   * 只认对象的话,「显式标记优先」这条设计会在最需要它的地方失效。
   */
  data?: { provenance?: string } | string | null;
  mediaUrls?: string[] | null;
  media_urls?: string | null;
  persistentUrl?: string | null;
  persistent_url?: string | null;
}

/**
 * 取出 data 里的 provenance。data 有两种形态:
 *   · 对象 —— 接口层已经解析过的;
 *   · JSON 字符串 —— 直接 SELECT 出来的原始行(listAssetsByType 就是这种)。
 *
 * 实测过这个洞:同一条资产,data 是字符串时判 false、是对象时判 true。
 * 而导出路径拿到的恰恰是字符串那种 —— 「显式标记优先」会在最需要它的地方失效。
 * 现在计数还对,是因为 URL 兜底碰巧命中;等资产被持久化成正常链接就不灵了。
 */
function provenanceOf(data: PlaceholderCheckable['data']): string | null {
  if (!data) return null;
  if (typeof data === 'string') {
    try {
      const o = JSON.parse(data);
      return typeof o?.provenance === 'string' ? o.provenance : null;
    } catch { return null; }   // 坏 JSON 不该让判断整个崩掉
  }
  return typeof data.provenance === 'string' ? data.provenance : null;
}

function urlsOf(a: PlaceholderCheckable): string[] {
  const out: string[] = [];
  if (Array.isArray(a.mediaUrls)) out.push(...a.mediaUrls.filter(Boolean) as string[]);
  if (typeof a.media_urls === 'string' && a.media_urls.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(a.media_urls);
      if (Array.isArray(arr)) out.push(...arr.filter((u) => typeof u === 'string'));
    } catch { /* 坏数据不该让判断整个崩掉 */ }
  }
  for (const u of [a.persistentUrl, a.persistent_url]) if (u) out.push(u);
  return out;
}

/**
 * 一条资产是不是示意图。**显式标记优先,URL 形态兜底。**
 *
 * 顺序不能反:标记是生成端写下的事实,形态是下游的推断。
 * 一旦某天示意图换了形态(比如改成真出一张灰底 PNG),推断会失效而标记不会。
 */
export function isPlaceholderAsset(asset: PlaceholderCheckable | null | undefined): boolean {
  if (!asset) return false;
  if (asset.isPlaceholder === true) return true;          // 服务端已在原始行上判过
  if (provenanceOf(asset.data) === PLACEHOLDER_PROVENANCE) return true;
  return urlsOf(asset).some(isPlaceholderUrl);
}

/** 给资产 data 打上标记;保留原有字段。 */
export function markPlaceholder<T extends Record<string, unknown>>(data: T | null | undefined): T & { provenance: string } {
  return { ...(data ?? {} as T), provenance: PLACEHOLDER_PROVENANCE };
}

/** 统计一批资产里有几条是示意图 —— 就绪判定与导出前提示都用它,别各算各的。 */
export function countPlaceholders(assets: Array<PlaceholderCheckable | null | undefined>): number {
  return assets.reduce((n, a) => n + (isPlaceholderAsset(a) ? 1 : 0), 0);
}

/**
 * 写入时决定这条资产的 `data.provenance`。**放在写入咽喉处,不在调用点逐个打标。**
 *
 * 为什么不逐点打标:实测有五条写入路径绕过主流程 ——
 * regenerate-shot / heal-shots / regenerate-shot-4k / regenerate-asset-image,
 * 以及 create-pipeline 里直接 createAsset 的构图草图。逐点打标必然漏掉其中一条,
 * 那就是本仓反复犯的「改了主路径忘旁路」。
 *
 * 三条规则,顺序不能乱:
 *
 *   ① **调用方显式写了 provenance** → 照用。生成端最清楚发生了什么,不要覆盖它。
 *   ② **这次带了新内容(有 mediaUrls / persistentUrl)** → 只按新 URL 判,**不继承旧标记**。
 *      一镜先出了示意图、后来真重生成功,标记必须能洗掉;否则它会永远背着这个标签。
 *   ③ **这次只改 data、没带内容** → 把旧标记带过来。
 *      因为 data 列是整体覆盖写(分镜要写两次,第二次是全新对象),
 *      不带过来的话第一次打的标记会被第二次静默擦掉。
 */
export function applyProvenance(
  data: unknown,
  ctx: {
    mediaUrls?: string[] | null;
    persistentUrl?: string | null;
    /** 旧行 data.provenance;仅在本次没带内容时才会被采用。 */
    previousProvenance?: string | null;
  },
): unknown {
  const obj = (data && typeof data === 'object' && !Array.isArray(data))
    ? { ...(data as Record<string, unknown>) }
    : data;
  if (!obj || typeof obj !== 'object') return data;   // 非对象 data 不动它
  const rec = obj as Record<string, unknown>;

  if (typeof rec.provenance === 'string' && rec.provenance) return rec;   // ①

  const incoming = [...(ctx.mediaUrls ?? []), ctx.persistentUrl ?? null].filter(Boolean) as string[];
  if (incoming.length > 0) {                                              // ②
    if (incoming.some(isPlaceholderUrl)) rec.provenance = PLACEHOLDER_PROVENANCE;
    return rec;
  }

  if (ctx.previousProvenance) rec.provenance = ctx.previousProvenance;    // ③
  return rec;
}
