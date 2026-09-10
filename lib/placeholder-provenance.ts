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
/**
 * 视频侧的说法(v12.430)。
 *
 * **没有合并成一个词,是想清楚之后的决定**:引擎全挂时视频回落的是 Ken Burns 占位片 ——
 * 它用的是**真的分镜画面**,假的是那段运镜。管它叫「示意图」是错的:它不是一张假图,
 * 是一段假运镜。所以是同一族两个词,一眼能看出是一回事,又各自说得准。
 */
export const PLACEHOLDER_LABEL_VIDEO = '示意片';

/** 按资产类型取该用哪个词 —— 调用方别各写各的。 */
export function placeholderLabelFor(type?: string | null): string {
  return /video|film|clip/i.test(String(type || '')) ? PLACEHOLDER_LABEL_VIDEO : PLACEHOLDER_LABEL;
}
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
/**
 * 从 data 里读一个字段,**对象态和 JSON 字符串态都要认**。
 *
 * 为什么必须统一:接口层拿到的 data 已被解析成对象,而**导出路径审计的是原始库行**
 * —— 那里 data 还是字符串。v12.430 第一版给视频判据写了个直接强转
 * `(asset.data as {isAnimatic?:boolean})?.isAnimatic`,于是对象态认得出、字符串态认不出:
 * 恰好把最该认出来的那条路径(交付)漏掉了。判据分两份写,就一定会漂成两种行为。
 */
function readDataField<T>(data: PlaceholderCheckable['data'], key: string): T | undefined {
  if (!data) return undefined;
  if (typeof data === 'string') {
    try { return (JSON.parse(data) as Record<string, unknown>)?.[key] as T | undefined; }
    catch { return undefined; }   // 坏 JSON 不该让判断整个崩掉
  }
  return (data as unknown as Record<string, unknown>)[key] as T | undefined;
}

function provenanceOf(data: PlaceholderCheckable['data']): string | null {
  const v = readDataField<string>(data, 'provenance');
  return typeof v === 'string' ? v : null;
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
 * 视频侧的「不是真产物」:所有视频引擎失败时回落的 Ken Burns 占位片(v12.430)。
 *
 * ## 为什么必须并进来
 *
 * 此前图像侧走 provenance、视频侧走 isAnimatic,两套判据互不相认。后果是**言之凿凿的漏报**:
 * 实测构造一部四镜全是占位片的成片,`countPlaceholders` 返回 **0**、导出说明为空 ——
 * 用户导出时一个字都不会被提醒。**说「没有问题」比什么都不说更糟。**
 *
 * ## 判据为什么是这两条(实测 data/qfmj.db 定的)
 *
 *   · `data.isAnimatic === true` —— 流水线写下的显式标记,**26 条**;
 *   · 路径含 `qf-animatic-<时间戳>` —— 我们自己生成的回落文件,**另 2 条没有上面那个标记**,
 *     只能靠它认出来。两者实测不重合,少哪条都会漏。
 *
 * ## 为什么**不**用宽泛的 `/animatic-\d+\.mp4/`
 *
 * **Ken Burns 是一种合法的运镜手法**,不是只有降级才会用。宽正则会把用户自己上传的
 * `animatic-1.mp4` 判成占位片 —— 那是反过来的谎。`qf-` 是我们自己的前缀,
 * 实测库里带 animatic 的路径**全部**带它(不带的:0 条),收窄不丢召回。
 */
export function isPlaceholderVideo(asset: PlaceholderCheckable | null | undefined): boolean {
  if (!asset) return false;
  if (readDataField<boolean>(asset.data, 'isAnimatic') === true) return true;
  return urlsOf(asset).some((u) => /qf-animatic-\d+/.test(u));
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
  if (isPlaceholderVideo(asset)) return true;             // v12.430:视频侧的占位片也算
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

/**
 * SQL 预筛片段(v12.431)—— 给「一次查一批项目」用。
 *
 * ## 为什么需要
 *
 * 判据是 JS(三种形态、还要读 JSON 字段),SQL 表达不了。但列表页要一次算几十个项目的
 * 占位数,把全部资产捞进内存再判,资产多了就撑不住(本机 30 个项目已有 1052 条)。
 * 所以让 SQL **只负责把行数收窄**,真正的判断仍在 `isPlaceholderAsset`。
 *
 * ## 唯一的硬要求:必须是超集
 *
 * 预筛漏掉一种形态 = 少算 = **漏报**,而漏报正是这一族 bug 里最难发现的形态
 * (v12.430 就是被这个坑了:视频侧判据没并进来,四镜全占位的成片导出时提示为空)。
 * 所以它和判据放在同一个文件里,并由 tests/v12-431 用一张「已知形态表」把两者绑住:
 * 每个已知形态都要**同时**满足「JS 判为真」和「预筛能命中」。
 *
 * 实测本机 1052 条资产:预筛收到 75 条,判出的占位数与全量扫描一致(36 = 36,零漏)。
 */
export const PLACEHOLDER_SQL_LIKE_PATTERNS: ReadonlyArray<{ col: 'data' | 'media_urls' | 'persistent_url'; like: string }> = [
  { col: 'data', like: '%placeholder%' },            // data.provenance
  { col: 'data', like: '%isAnimatic%' },             // 视频侧显式标记
  { col: 'media_urls', like: '%mock-assets%' },      // mock 引擎产物服务
  { col: 'media_urls', like: '%qf-animatic%' },      // Ken Burns 回落路径
  { col: 'media_urls', like: '%data:image/svg%' },   // 内联 SVG 占位
  { col: 'persistent_url', like: '%mock-assets%' },  // 落盘后仍带 mock 路径的
];

/** 拼成 WHERE 片段。`alias` 是 project_assets 的表别名。 */
export function placeholderPrefilterSql(alias = 'a'): string {
  return '(' + PLACEHOLDER_SQL_LIKE_PATTERNS
    .map((p) => `${alias}.${p.col} LIKE '${p.like}'`)
    .join(' OR ') + ')';
}
