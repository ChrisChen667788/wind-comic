/**
 * 「消费方门禁」契约表 —— v12.240。
 *
 * ## 为什么有这个文件
 *
 * v12.218→v12.239 二十多个版本的安全加固里,**同一个病犯了五次**:
 *
 * | 版本 | 我改了(判定/解析层) | 却漏了(消费方) |
 * |---|---|---|
 * | v12.233 | `findCjkFont()` 改开源优先 | `subtitle-burn` 预设、`video-composer` 兜底、`cover-title-burn` 顺序全是硬编码 |
 * | v12.235 | 写了 `assertOutboundUrlSafe` | `fetch` 默认跟随 302,守卫只看初始 URL |
 * | v12.237 | serve-file HTTP 端点验签 | `persistAsset`/`serveFileToLocalPath` 自己解析 `?path=` 直接读盘 |
 * | v12.238 | 把 provider 注册进 registry | plugin chain 默认 off,`generate()` 一次都没被调用 |
 * | v12.239 | 补 IPv6 判定 | 又漏三类隧道写法(NAT64 local-use / Teredo / ISATAP) |
 *
 * 每一次都是**人肉对抗复检**才发现的。复检很贵(五轮 ~340 万 token),而且它只能发现
 * 「已经发生的」——下一次新代码照样可能再犯。所以把这类不变量固化成**入库门禁**:
 * 建立唯一入口,禁止绕过它的写法,新增例外必须显式登记理由。
 *
 * ## 设计原则(每一条都是踩出来的)
 *
 * 1. **每条契约必须对应真实事故** —— 空泛的最佳实践不进表,否则噪音淹没信号。
 * 2. **先剥注释再匹配** —— v12.234 和 v12.239 各踩过一次:解释病根的注释里引用了同一串字符,
 *    把自己的锁弄红了。「把问题讲清楚」不该让门禁报警。
 * 3. **白名单必须带 reason** —— 加白名单 = 显式声明「我知道我在绕过,理由是 X」。
 *    没有理由的白名单条目本身就是违规。
 * 4. **门禁只做静态能做的** —— 有些病(判定只认一种书写形式、注册了但没被调用)静态扫不出来,
 *    这些在 `runtimeGateNotes` 里注明,靠专门的运行时测试兜,不假装门禁覆盖了它们。
 */

export interface GateContract {
  /** 稳定 id(违规报告里显示,白名单按它归类)。 */
  id: string;
  /** 一句话说清这条契约要求什么。 */
  rule: string;
  /** 对应的真实事故 —— 没有事故就不该有契约。 */
  incident: string;
  /** 唯一入口(允许做这件事的地方);仅用于报错信息里的指引。 */
  entry: string;
  /** 匹配「绕过写法」的正则(在**剥掉注释与字符串字面量之后**的代码上跑)。 */
  forbid: RegExp;
  /** 扫描范围:相对仓库根的目录前缀。 */
  scope: string[];
  /**
   * 只在这些 HTTP handler 的函数体内匹配(留空 = 整个文件)。
   * v12.241 清债时发现的精度问题:sentinel 契约叫「不得放行**写**操作」,
   * 但实现是整文件扫,于是 metrics / prompt-ide 这两个**只读 GET**里的哨兵也被判违规。
   * 契约名与实现不符时,该修的是实现,不是往白名单里塞。
   */
  handlerScope?: string[];
  /** 允许的例外 —— 每条都必须写清 why。 */
  allow: Array<{ file: string; why: string }>;
}

/**
 * 静态扫不出来、必须靠运行时测试守的病 —— 在这里如实登记,
 * 避免「门禁绿了 = 这类问题不存在」的错觉(那正是 v12.238 的假绿)。
 */
export const RUNTIME_ONLY_GAPS: Array<{ gap: string; incident: string; guardedBy: string }> = [
  {
    gap: '判定函数只认某一种书写形式(同一语义的其他写法绕过)',
    incident: 'v12.236 `::ffff:7f00:1` 与 `::ffff:127.0.0.1` 同址,正则只认后者;v12.237/239 又漏 6to4/NAT64/Teredo/ISATAP',
    guardedBy: 'tests/v12-236|237|239 的变体穷举用例 —— 新增判定分支时必须同步补「同语义不同写法」的表驱动用例',
  },
  {
    gap: '组件注册了但从未被执行(链路开关默认关)',
    incident: 'v12.238 两个 image provider 注册进 registry 且排序正确,但 plugin chain 默认 off → generate() 一次没跑',
    guardedBy: 'tests/v12-243-provider-reachability.test.ts(**遍历真实注册表**,新 provider 自动纳入)' +
      ' + tests/v12-239-plugin-actually-runs.test.ts(用探针验 withXxxPlugin 的调用机制)',
  },
  {
    gap: '新付费路径未接入成本记账(记账条件与新返回形态不匹配)',
    incident: 'v12.239 两个 provider 返 data: URI,而记账正则只匹配 http(s)|/api/serve-file → 完全不记账',
    guardedBy: 'tests/v12-239-recheck5 的记账条件断言 + 本文件 cost-log-shape 契约(只能查形态,查不了「有没有真记」)',
  },
];

export const CONTRACTS: GateContract[] = [
  {
    id: 'script-asset-must-use-pickScriptAsset',
    rule: '读 script 资产必须走 lib/script-asset 的 pickScriptAsset,禁止直接取 scriptRows[0] / scriptAssets[0]',
    incident:
      'v12.381:一个项目的 script 资产可以有好几条 —— 主稿 +「一键多语」产出的 script-<lang> + script-original 备份。' +
      'listAssetsByType 是 ORDER BY shot_number,而 script 的 shot_number 全是 NULL,顺序实际由插入次序决定。' +
      'localize 自己写了一份过滤、pull-sheet 与 recompose 各自直接取 [0] —— 三份实现三种行为。' +
      'v12.381 立了唯一入口却**只手工接了三个消费方**,v12.383 的全仓扫描又挖出三个漏网的:' +
      'pull-sheet/import(读写都落在 [0],CSV 回灌会把改动 merge 进俄语稿、主稿一字未改,接口还是 200)、' +
      'pull-sheet/replicate(用俄语台词和角色名起一个全新项目)、pull-sheet/save-template。' +
      '手工枚举消费方漏了一半 —— 这正是本门禁存在的理由。',
    entry: 'pickScriptAsset(rows, language) from lib/script-asset',
    // 只拦「script 资产数组取第一条」这个具体写法。变量名两种拼法都收 ——
    // 实测仓库里 recompose 叫 scriptAssets、pull-sheet 系叫 scriptRows。
    forbid: /\bscript(Assets|Rows)\s*\[\s*0\s*\]/,
    scope: ['app/api', 'lib', 'services'],
    allow: [],
  },
  {
    id: 'outbound-fetch-must-use-safeFetch',
    rule: '任何服务端出站 HTTP 必须走 lib/ssrf-guard 的 safeFetch(它逐跳重验重定向),禁止裸 fetch(',
    incident:
      'v12.235:assertOutboundUrlSafe 只校验初始 URL,而 fetch 默认 redirect:follow —— ' +
      '攻击者用自己控制的公网地址 302 到 169.254.169.254,整道 SSRF 防线被完整绕过。',
    entry: 'safeFetch(url, init) from lib/ssrf-guard',
    /**
     * **拦所有裸 fetch,靠文件级白名单 + 必填理由放行。**
     *
     * 这条正则改过两版,两版都错,记下来:
     *
     * · **第一版**「拦所有 fetch」→ 一跑 60 处,绝大多数是打固定端点,噪音必然逼人狂加白名单。
     * · **第二版**「只拦 `fetch(` 后跟裸标识符」→ 噪音降到 24 处,但**自查发现 8 种写法漏 7 种**:
     *   `fetch(obj.url)`、`fetch(arr[0])`、**`fetch(body.imageUrl)`(直接来自请求体!)**、
     *   `` fetch(`${userUrl}`) ``、`const f = fetch; f(url)`、`globalThis.fetch(url)`、跨行调用。
     *   一个漏掉「直接 fetch 请求体字段」的 SSRF 门禁,等于没有。
     *
     * 错在哪:我想用正则区分「URL 来自配置」和「URL 来自数据流」—— 这**静态根本做不到**,
     * `fetch(`${A}/x`)` 里的 A 是常量还是用户输入,正则看不出来。硬猜的结果就是漏 7/8。
     *
     * 所以第三版**不猜了**:拦所有裸 fetch,例外走文件级白名单**并强制写明 URL 来源**。
     * 代价是白名单变长(一次性),换来的是:**新写一个 fetch 就必须回答「这个 URL 从哪来」** ——
     * 而这恰恰是这套门禁存在的全部意义。
     */
    forbid: /(?<![\w.$])fetch\s*\(|globalThis\s*\.\s*fetch|=\s*fetch\s*[;,)\n]/,
    scope: ['lib/', 'services/', 'app/api/'],
    allow: [
      { file: 'lib/ssrf-guard.ts', why: 'safeFetch 的实现本体,它必须调裸 fetch' },
      { file: 'lib/fetch-timeout.ts', why: 'v12.304:纯超时装饰器(AbortController + clearTimeout),不解析也不改写 URL —— SSRF 判断权留在调用方。刻意不内建 safeFetch:现有四个消费方(veo/minimax/kling/happyhorse)的 base URL 来自配置,自托管网关常在内网,套守卫会误拒真实部署。**新增调用方必须单独评估**是否该改走 safeFetch' },
      { file: 'lib/image-providers/openrouter-image.ts', why: 'v12.96 既有档,固定打 openrouter.ai 常量域名,不接受用户 URL' },
      { file: 'lib/llm-client.ts', why: 'LLM 网关地址来自 env 配置而非请求输入,且不跟随到用户可控目标' },
      // ── v12.241 清存量债时逐个核实后登记的例外 ──
      // 各引擎 service 的 fetchWithTimeout(url, init) 包装:url 由本 service 用配置好的 base 拼出,
      // 不接受请求体输入;真正的外部 URL 消费方(拉媒体的那些)已在本轮改走 safeFetch。
      { file: 'services/fal-flux.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/grok-imagine.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/kling.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/lipsync-providers.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/ltx.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/midjourney.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/minimax.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/seedance.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'services/veo.service.ts', why: 'fetchWithTimeout 包装,url 由 service 内部按配置 base 构造' },
      { file: 'lib/broll.ts', why: 'u 是上一行拼好的 api.pexels.com 固定端点常量,启发式把它当变量了(保守误报)' },
      { file: 'lib/storage.ts', why: 'S3 端点由 cfg.endpoint/bucket 构造;自托管 MinIO 常在内网,过 SSRF 守卫反而会拒真实部署' },
      { file: 'lib/email-sender.ts', why: 'RESEND_API 是模块内常量,SendGrid 也是写死的域名' },
      { file: 'lib/sse-client.ts', why: '浏览器端 SSE 订阅工具,不是服务端出站' },
      { file: 'lib/lipsync-providers/builtins.ts', why: 'url 来自 LIPSYNC_API_URL 配置;自托管 wav2lip 常在内网,守卫会误拒' },
      { file: 'lib/image-providers/example-replicate.ts', why: '示例文件;pollUrl 来自 replicate 上游响应的自家轮询地址' },
      { file: 'services/comfyui.service.ts', why: 'ComfyUI 多为自托管(localhost/内网),需显式配 COMFYUI_URL 才启用,过守卫会拒掉真实部署' },
      { file: 'app/api/health/providers/route.ts', why: 'timedFetch 探测的是代码里写死的各家健康检查端点' },
      { file: 'app/api/projects/[id]/anytext-cover/route.ts', why: 'apiUrl 来自 ANYTEXT_API_URL 配置,自托管服务常在内网' },
      // ── v12.242:契约改为「拦所有裸 fetch」后,逐个核实并按类登记 ──
      // 统一判据:URL 由**配置好的 base + 代码里写死的路径**拼成,不含请求体字段。
      // 真正吃外部 URL 的消费方(voice-clone 的音样、url-to-brief 的商品页、拉媒体那几处)
      // 已全部改走 safeFetch —— 它们不在这张表里。
      { file: 'services/*.service.ts', why: '各引擎 service:URL = 本 service 的配置 baseURL + 写死的 API 路径' },
      { file: 'lib/image-providers/*', why: '图像 provider:URL = 配置 base + 该家写死的端点路径' },
      { file: 'lib/tts-providers/*', why: 'TTS provider:URL = 配置 base + 写死的端点路径' },
      { file: 'lib/video-providers/*', why: '视频 provider:URL = 配置 base + 写死的端点路径' },
      { file: 'lib/api-client.ts', why: 'URL = API_BASE 常量 + 调用方给的**内部**路径,不接受外部 URL' },
      { file: 'lib/character-traits.ts', why: 'URL = API_CONFIG.openai.baseURL + /chat/completions(写死)' },
      { file: 'lib/model-scan.ts', why: 'URL = 待探测网关的 spec.baseUrl(来自配置清单)+ 写死的 /models、/chat/completions' },
      { file: 'lib/image-tools/bg-removal.ts', why: 'backend.url 来自 BG_REMOVAL_URL 配置;rembg 服务多为自托管内网,过守卫会拒真实部署' },
      { file: 'services/hybrid-orchestrator.ts', why: 'URL = 配置的 apiBase/base + 写死的 /v1/images/generations' },
      { file: 'app/api/polish-script/route.ts', why: 'URL = 配置的 a.baseURL + 写死的 /chat/completions' },
      { file: 'app/api/test-llm/route.ts', why: 'URL = API_CONFIG.openai.baseURL + 写死路径(连通性自检端点)' },
      { file: 'app/api/projects/[id]/ad-workshop/route.ts', why: '`${origin}${path}` 打**本站自己**的内部 API,origin 由服务端算出、path 写死' },
      { file: 'app/api/projects/[id]/heal-shots/route.ts', why: '`${origin}/api/projects/{id}/recompose` 打本站自己的内部 API' },
    ],
  },
  {
    id: 'servefile-url-must-be-signed',
    rule: '生成 /api/serve-file?path= 链接必须走 serveFilePathUrl()(带 HMAC 签名),禁止手拼',
    incident:
      'v12.236:?path= 只做「登录 + 目录白名单」,成片名是 final-<时间戳>.mp4 —— ' +
      '任何登录用户拿到路径即可下载他人成片。改为签名能力 URL 后,手拼的一律无效。',
    entry: 'serveFilePathUrl(absPath) from lib/serve-file-sign',
    forbid: /\/api\/serve-file\?path=\$\{encodeURIComponent\(/,
    scope: ['lib/', 'services/', 'app/'],
    allow: [
      { file: 'lib/serve-file-sign.ts', why: '签名函数本体,唯一合法的手拼点' },
    ],
  },
  {
    id: 'servefile-param-must-be-verified',
    rule: '解析 ?path= 取本地路径后读盘,必须经 resolveVerifiedServeFilePath()(验签 + 白名单)',
    incident:
      'v12.237:v12.236 只给 HTTP 端点验签,漏了 persistAsset / serveFileToLocalPath 两条**服务端本地读盘路径** —— ' +
      'cameo/pull-sheet/video-anchor 把用户 body 的 ?path= 喂进来即可读任意文件。签了前门,漏了侧门。',
    entry: 'resolveVerifiedServeFilePath(url) from lib/serve-file-sign',
    // 手工从 serve-file URL 里抠 path 参数 = 绕过验签
    forbid: /searchParams\.get\(\s*['"]path['"]\s*\)|URLSearchParams\([^)]*\)\.get\(\s*['"]path['"]\s*\)/,
    scope: ['lib/', 'services/', 'app/api/'],
    allow: [
      { file: 'lib/serve-file-sign.ts', why: 'resolveVerifiedServeFilePath 的实现本体 —— 它必须先取出 path 参数才能验签' },
      { file: 'app/api/serve-file/route.ts', why: 'serve-file 路由自身:取参后立刻 verifyServeFileSig' },
      { file: 'services/video-composer.ts', why: 'downloadFile 只处理**本进程刚生成**的内部 URL,不接受请求体输入' },
      { file: 'app/api/projects/[id]/audio-check/route.ts', why: '只对已通过 requireProjectAccess 的本项目资产做 ffprobe' },
    ],
  },
  {
    id: 'cjk-font-must-be-resolved',
    rule: 'CJK 字体一律经 findCjkFont() / resolveCjkFontName() 解析,禁止硬编码系统专有字体路径或字体名',
    incident:
      'v12.233 只改了解析函数就宣布「字体 EULA 已合规」,而真正把字形烧进成片的三条路径 ' +
      '(video-composer 两处硬编码、subtitle-burn 四个平台预设、cover-title-burn 候选顺序)原封不动;' +
      'v12.239 又发现 fontForLanguage 的 ko/ja 分支仍返回 Apple 专有字体名。',
    entry: 'findCjkFont() / resolveCjkFontName() from lib/text-control、lib/subtitle-burn',
    forbid: /['"`][^'"`]*\/System\/Library\/Fonts\/[^'"`]*['"`]|['"`](PingFang SC|Hiragino Sans|Apple SD Gothic Neo|STHeiti[^'"`]*)['"`]/,
    scope: ['lib/', 'services/', 'app/'],
    allow: [
      { file: 'lib/text-control.ts', why: '字体候选表本体:系统字体作为最后兜底登记在此,并标注 EULA 限制' },
      { file: 'lib/cover-title-burn.ts', why: '封面候选表本体:开源优先、系统字体列在末位兜底' },
      { file: 'lib/polish-docx.ts', why: '导出的是 Word HTML(.doc),font-family 只是让 Word 在本机查找字体,不嵌入字形,故不涉 EULA 分发' },
      { file: 'lib/script-export.ts', why: 'v12.241 已把思源/Noto 提到 font-family 首位,系统字体只作末位回退(与 cover-title-burn 同款);正则查的是「出现」而非「排序」,故登记为例外' },
    ],
  },
  {
    id: 'external-io-must-have-timeout',
    rule: '出站请求必须带超时(signal),否则慢速上游可无限占用连接',
    incident:
      'v12.239:gemini-image 的参考图拉取 safeFetch(url, {}) 传空 init,而外层 120s 只覆盖最终那次调用 —— ' +
      '慢速流(1KB/s 吐 12MB)× 3 并发能把连接挂住数小时。',
    entry: 'AbortSignal.timeout(ms) 或 AbortController',
    // 空 init 的 safeFetch 调用 = 没有超时
    forbid: /safeFetch\([^,)]+,\s*\{\s*\}\s*\)/,
    scope: ['lib/', 'services/', 'app/api/'],
    allow: [],
  },
  {
    id: 'sentinel-must-not-pass-writes',
    rule: "写 handler 里出现 = '__no_auth__' 时,同一 handler 内必须有真守卫",
    incident:
      'v12.234/236:身份解析失败后赋哨兵**然后继续执行** —— review-status 可 approve 任意项目、' +
      'save-template 可读任意项目元数据、global-assets 可匿名写入。哨兵的语义是「查空」,不是「无身份也放行」。',
    entry: 'requireUser / requireProjectAccess / guardPaidEndpoint',
    forbid: /=\s*['"]__no_auth__['"]/,
    scope: ['app/api/'],
    handlerScope: ['POST', 'PUT', 'PATCH', 'DELETE'], // 只读 GET 用哨兵查空是安全默认,不算违规

    allow: [
      { file: 'lib/repos/pipeline-job-repo.ts', why: '仓储层用哨兵做「查不到就返空集」的安全默认,不是放行' },
    ],
  },
  {
    id: 'dangerous-env-switch-must-die-in-prod',
    rule: '能削弱安全的 env 开关,必须在 NODE_ENV=production 下强制失效',
    incident:
      'v12.222 PLAN_GATE_DISABLED 可在生产穿墙;v12.236 DEMO_ADMIN=1 让 demo 账号首次 seed 即 admin —— ' +
      '开发者把整份 env 拷到生产就把 admin 接口交给了公开凭据。「配错就等于不设防」的开关必须自己死掉。',
    entry: "if (... && process.env.NODE_ENV === 'production') 强制忽略并告警",
    // 这条不做正则拦截(写法太多),仅登记;实际检查在下面的 envSwitchAudit
    forbid: /(?!)/, // 永不匹配 —— 见 auditEnvSwitches
    scope: [],
    allow: [],
  },
];

/**
 * 需要「生产强制失效」的危险开关清单 —— 扫描器会检查每个开关所在文件里
 * 确实存在 production 门控。比正则拦截更准,也更好维护。
 */
export const DANGEROUS_ENV_SWITCHES: Array<{ name: string; file: string; why: string }> = [
  { name: 'PLAN_GATE_DISABLED', file: 'lib/plan-gate.ts', why: '关掉套餐门禁 = 免费用户可消费高价引擎(v12.222)' },
  { name: 'DEMO_ADMIN', file: 'lib/db.ts', why: 'demo 账号提权为 admin,而 demo 凭据是公开的(v12.236)' },
  { name: 'SSRF_ALLOW_PRIVATE', file: 'lib/ssrf-guard.ts', why: '放行内网出站 = SSRF 守卫整体失效(v12.234)' },
];
