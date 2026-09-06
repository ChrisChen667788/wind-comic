/**
 * 项目封面的解析(v12.426)。
 *
 * ## 为什么需要
 *
 * 封面此前是**流水线结束时抄的一份快照**:
 *   create-pipeline.ts → const coverUrl = finalStoryboards[0]?.imageUrl || ''
 * 抄完就冻住,此后再不重算。于是两种情况会永久留下一张假封面:
 *
 * 1. **出图全挂时抄到了 mock 占位图**。hybrid-orchestrator 在所有图像引擎失败后返回
 *    `mockSvg(1024, 576, '#1e1b4b', '#7c3aed', 'Shot 1')` —— 只打一条 warn,
 *    返回值却长得像一次正常出图。这张紫色渐变图被原样抄进 cover_urls。
 *    实测:owner 的 30 个项目里 12 个封面就是它,其中 3 个(月挂不下来 / 宿命之柱 /
 *    AI觉醒)明明各有 11~12 张真分镜还活着 —— 用户后来重生过,但封面没人重算。
 *
 * 2. **抄到了通用风格样张**。两个演示工程的封面是 /styles/blue-hour.jpg 和
 *    /styles/cyberpunk.jpg —— 那是风格库的示例图,不是这个项目自己的画面。
 *
 * 另有一处「造好没接线」:用户可以在封面候选面板里定版(落 `chosen-cover` 资产),
 * 但只有 publish-package 读它,项目卡片压根不看 —— 用户选了也白选。
 *
 * ## 解法
 *
 * 不做数据迁移,改成**读时解析**:封面每次按当下最好的可用素材算出来,
 * 素材变了封面自动跟着变。冻结的 cover_urls 只作为其中一档候选,不再是唯一真相。
 */

/**
 * 一张图是不是「引擎全挂时的 mock 占位」——它长得像成功,但不是真画面。
 *
 * mock 产物有**两种形态**,第一版只认了第一种,于是绿皮书之约的卡片在实拍里
 * 显示成一块纯绿色矩形 —— 判据写死了字面量,而不是「这是不是 mock」:
 *   ① `data:image/svg…`      —— 内联 SVG(hybrid-orchestrator 的 mockSvg 兜底、UI 占位图)
 *   ② `/api/mock-assets/…`   —— mock 引擎的确定性产物服务(渐变 SVG / 纯色短片 / 正弦音)
 * 凡是这个服务出来的,按定义就不是真生成内容。
 */
export function isMockPlaceholder(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.startsWith('data:image/svg')) return true;
  return /(^|\/\/[^/]*)\/api\/mock-assets\//.test(url);
}

/** 一张图是不是风格库的通用样张 —— 能看,但不是这个项目自己的画面。 */
export function isGenericSample(url: string | null | undefined): boolean {
  return !!url && /^\/styles\//.test(url);
}

/**
 * 一张图的 URL 是不是**已经过期的签名链**。
 *
 * 引擎返回的直链常把过期时刻明写在 query 里(实测赤马斩龙的封面:
 * `…?Expires=1781694879…`,对应 2026-06-17,早已过期)。既然写着,就该读出来比较,
 * 而不是让它和永久链接平起平坐 —— 否则卡片每次都要先请求一张必定 404 的图。
 *
 * 只认绝对时间戳形式的 `Expires=<unix 秒>`:这是数据里实际存在的形态。
 * `X-Amz-Expires` 是「相对 X-Amz-Date 的秒数」,语义不同,不在这里瞎猜。
 */
export function isExpiredUrl(url: string | null | undefined, now: number = Date.now()): boolean {
  if (!url) return false;
  const m = /[?&]Expires=(\d{9,13})(?:&|$)/.exec(url);
  if (!m) return false;
  const raw = Number(m[1]);
  // 10 位是秒,13 位是毫秒
  const ms = raw > 1e12 ? raw : raw * 1000;
  return ms < now;
}

export type CoverCandidate = {
  /** 'chosen' 用户定版 | 'stored' 冻结的 cover_urls | 'storyboard' 本项目分镜 | 'video' 本项目成片首帧 */
  source: 'chosen' | 'stored' | 'storyboard' | 'video';
  url: string | null | undefined;
};

/**
 * 按优先级排出**一串**候选封面,而不是只挑一张。
 *
 * 为什么要一串:读时解析没法便宜地验活。实测踩到两种情况——
 *   · 外链封面会过期(hailuo OSS 那批已 404);
 *   · 同一镜在库里有两条分镜记录:最早那条 media_urls 是空的,真画面在后来
 *     「重生」的记录里。只取一张就会稳定取到那条死的。
 * 所以给调用方一串,前一张加载失败就换下一张 —— 最后才退到 UI 占位图。
 *
 * 顺序的道理:用户明确选过的最大;其次是这个项目**自己的**画面;
 * 通用风格样张排在自有画面之后(能看但不是本片);mock 占位图直接剔除 ——
 * 宁可退回 UI 兜底图,也不要把「出图失败」冒充成「这部片长这样」。
 */
export function resolveProjectCovers(candidates: CoverCandidate[]): string[] {
  const own: string[] = [];
  const generic: string[] = [];
  const expired: string[] = [];
  const order: CoverCandidate['source'][] = ['chosen', 'stored', 'storyboard', 'video'];

  for (const src of order) {
    for (const c of candidates) {
      if (c.source !== src || !c.url) continue;
      if (isMockPlaceholder(c.url)) continue;            // 出图失败的产物,永不作封面
      // 已过期的签名链排到最后:留着是为了「万一服务端没真按 Expires 拒绝」,
      // 但绝不能排在永久链接前面 —— 否则每次都先打一发必 404 的请求。
      if (isExpiredUrl(c.url)) { expired.push(c.url); continue; }
      (isGenericSample(c.url) ? generic : own).push(c.url);
    }
  }
  // 去重但保序
  return [...new Set([...own, ...generic, ...expired])];
}

/**
 * 候选串走到下一张的下标;走完返回 null(调用方该退到 UI 占位图)。
 *
 * 抽成函数不是为了复用,是为了**可测**:第一版把这段逻辑内联在卡片的 onError 里,
 * 测试只能断言源码含 "coverIdx" 字样 —— 把 `next` 改成常量 999(回退彻底失效)
 * 那条断言照样绿。锁写法不锁行为,等于没锁。
 */
export function nextCoverIndex(current: number, total: number): number | null {
  if (!Number.isFinite(current) || current < 0) return total > 0 ? 0 : null;
  const next = Math.floor(current) + 1;
  return next < total ? next : null;
}
