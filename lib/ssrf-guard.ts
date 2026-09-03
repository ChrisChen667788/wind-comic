/**
 * v12.234 — 统一 SSRF 出站白/黑名单守卫。
 *
 * 背景(二轮对抗复检 · 独立安全分析):此前有两条互不相干的出站 fetch 路径,各写各的防护:
 *   · `app/api/serve-file?proxy=` —— 一条正则拦 `127./10./192.168./172.16-31./localhost/0.0.0.0`;
 *   · `lib/asset-storage.ts persistAsset()` —— **完全没有**任何 IP 过滤,来者不拒。
 *
 * 那条正则漏掉的正是最值钱的目标:
 *   · `169.254.169.254` —— AWS/GCP/Azure 实例元数据服务(IMDS),能直接读 IAM 临时凭证;
 *   · IPv6 回环 `[::1]` 与 IPv6 私网 `fc00::/7`、链路本地 `fe80::/10`;
 *   · 十六进制/十进制/八进制编码的 IPv4(`0x7f000001`、`2130706433`、`0177.0.0.1`);
 *   · `metadata.google.internal` 这类**解析到内网的域名**(正则只看字面量,看不见 DNS 结果)。
 *
 * 所以这里做两层:
 *   1. **字面量层**:归一化主机名(去括号、解码各种进制),对已知内网段直接拒;
 *   2. **DNS 层**:真去解析域名,拿到的每个 A/AAAA 地址都过一遍同一套判定 ——
 *      这层才是拦 DNS-rebinding / 内网别名域名的关键,只做字面量匹配等于没做。
 *
 * 注意:DNS 解析与真正 fetch 之间仍有 TOCTOU 窗口(rebinding 可在两次解析间换 IP)。
 * 彻底堵需要在 socket 层校验对端地址(undici 的 connect 钩子),那是更大的改造;
 * 当前实现把门槛从「零成本」提到「需要精确控制 DNS TTL 的竞态」,并在此如实标注局限。
 */
import dns from 'dns/promises';
import net from 'net';

/** 判定一个**已是 IP 字面量**的字符串是否属于不可出站的内网/保留段。 */
export function isBlockedIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8 私网
    if (a === 127) return true;                     // 回环
    if (a === 169 && b === 254) return true;        // 链路本地 —— 含 169.254.169.254 云 IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 私网
    if (a === 192 && b === 168) return true;        // 192.168/16 私网
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 192 && b === 0) return true;          // 192.0.0/24 IETF 协议保留
    if (a >= 224) return true;                      // 组播 224/4 + 保留 240/4
    return false;
  }

  if (net.isIPv6(v)) {
    if (v === '::1' || v === '::') return true;                 // 回环 / 未指定
    if (/^fe[89ab]/.test(v)) return true;                       // fe80::/10 链路本地
    if (/^f[cd]/.test(v)) return true;                          // fc00::/7 唯一本地

    // v12.236(第三轮对抗复检 · CRITICAL,打在我自己 v12.234 刚写的代码上):
    // 此处原本只用正则 /::ffff:(\d+\.\d+\.\d+\.\d+)$/ 匹配**点分十进制**写法的 IPv4 映射地址。
    // 但 RFC 4291 允许同一地址用纯十六进制分组表示:`::ffff:7f00:1` === `::ffff:127.0.0.1`。
    // 正则不匹配 → 直接放行,而 Linux 双栈套接字会把它连到真正的 127.0.0.1。
    // 实测放行过:::ffff:7f00:1(127.0.0.1)、::ffff:a00:1(10.0.0.1)、
    // ::ffff:c0a8:101(192.168.1.1)、**::ffff:a9fe:a9fe(169.254.169.254,云 IMDS)**。
    // 而我 v12.234 写的测试只覆盖了点分那一种写法 —— 测试照着实现写,就只会确认实现的偏见。
    // 现在:先把地址**展开成 8 组**再判定,不依赖任何书写形式。
    // v12.242:Teredo(2001:0::/32)**整段直接拒**,不绕道「取反后判内网」。
    // 原实现让 embeddedIpv4 取反出客户端 IPv4 再递归判定,后果是:任何第一段 < 32 的
    // **公网** IPv4(如 8.8.8.8)取反后都 ≥ 224,被 `a>=224` 判成「组播/保留」——
    // 结论(拦)碰巧对,理由(组播)却是错的,排障时会把人带偏。
    // 正确的说法是:Teredo 是隧道机制,作为服务端出站目标没有正当业务场景,一律不放行。
    const g = expandIpv6(v);
    if (g && g[0] === 0x2001 && g[1] === 0x0000) return true;

    const embedded = embeddedIpv4(v);
    if (embedded) return isBlockedIp(embedded);
    return false;
  }

  return false; // 不是 IP 字面量 → 交给调用方走 DNS 那层
}

/** 把 IPv6 展开成 8 个 16 位分组(处理 `::` 压缩与内嵌点分 IPv4);非法返回 null。 */
export function expandIpv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!net.isIPv6(s)) return null;
  s = s.replace(/%.*$/, ''); // 去掉 zone id(fe80::1%en0)

  // 内嵌点分 IPv4(::ffff:127.0.0.1)先转成两组十六进制,后续统一按 8 组处理
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    s = s.slice(0, -dotted[1].length) + `${hi}:${lo}`;
  }

  const [head, tail] = s.split('::');
  const h = head ? head.split(':').filter(Boolean) : [];
  const t = tail !== undefined && tail ? tail.split(':').filter(Boolean) : [];
  const groups = s.includes('::')
    ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
    : s.split(':');
  if (groups.length !== 8) return null;

  const nums = groups.map((g) => parseInt(g || '0', 16));
  return nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : nums;
}

/**
 * 若该 IPv6 内嵌了 IPv4(不论用什么书写形式),返回点分十进制的 IPv4;否则返回 null。
 * 覆盖:IPv4 映射 `::ffff:0:0/96`、已废弃的 IPv4 兼容 `::a.b.c.d`、NAT64 前缀 `64:ff9b::/96`。
 */
export function embeddedIpv4(ip: string): string | null {
  const g = expandIpv6(ip);
  if (!g) return null;
  const toV4 = () => [(g[6] >> 8) & 255, g[6] & 255, (g[7] >> 8) & 255, g[7] & 255].join('.');

  const zeroHead = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (zeroHead && g[5] === 0xffff) return toV4();                      // ::ffff:x.x.x.x 映射
  if (zeroHead && g[5] === 0 && (g[6] !== 0 || g[7] > 1)) return toV4(); // ::x.x.x.x 兼容(排除 ::1/::)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return toV4();                                                      // 64:ff9b::/96 NAT64(RFC 6052)
  }
  // v12.239(第五轮复检):RFC 8215 的 local-use NAT64 前缀 64:ff9b:1::/48 —— g[2]=1,
  // 上面那条 `g[2]===0` 卡死,于是 64:ff9b:1::a9fe:a9fe(→云 IMDS)被放行。实测确认过。
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return toV4();
  // ISATAP(RFC 5214):接口标识符后 64 位为 0000:5efe:<v4> 或 0200:5efe:<v4>。
  // fe80:: 前缀的已被链路本地正则拦住,但**任意其他前缀**(如 2001:db8::5efe:...)此前完全放行。
  if (g[5] === 0x5efe && (g[4] === 0x0000 || g[4] === 0x0200)) return toV4();
  // 注:Teredo(2001:0::/32)不在这里处理 —— isBlockedIp 在调本函数之前就把整个 2001:0::/32
  // 段直接拒了(见 v12.242 注释),不需要再从取反位里抠客户端 IPv4。
  // v12.237(第四轮对抗复检 · HIGH):6to4 `2002::/16`(RFC 3056)把目的 IPv4 编在 g[1,2] ——
  // v12.236 的 embeddedIpv4 只查 g[6,7],于是 2002:a9fe:a9fe::(→169.254.169.254 云 IMDS)被放行。
  // 在配了 sit/6to4 隧道的 Linux 生产机上,连它就直达内网。补上这一分支。
  if (g[0] === 0x2002) {
    return [(g[1] >> 8) & 255, g[1] & 255, (g[2] >> 8) & 255, g[2] & 255].join('.');
  }
  return null;
}

/**
 * 把各种「花式写法」的主机名归一化成点分十进制 IPv4;不是 IPv4 变体则原样返回。
 * 攻击者常用 `http://0x7f000001/`、`http://2130706433/`、`http://0177.0.0.1/` 绕过字面量正则。
 */
export function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  // 纯十进制整数形式:2130706433 → 127.0.0.1
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
  }
  // 十六进制整体形式:0x7f000001
  if (/^0x[0-9a-f]+$/.test(h)) {
    const n = parseInt(h, 16);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
  }
  // 逐段进制混写:0177.0.0.1(八进制段)/ 0x7f.0.0.1(十六进制段)
  const parts = h.split('.');
  if (parts.length === 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|\d+)$/.test(p))) {
    const nums = parts.map((p) =>
      /^0x/.test(p) ? parseInt(p, 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : Number(p),
    );
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return nums.join('.');
  }
  return h;
}

export type SsrfVerdict = { ok: true } | { ok: false; reason: string };

/**
 * 出站 URL 安全校验:协议 → 主机字面量 → DNS 解析结果,三道都过才放行。
 *
 * `allowPrivate` 供本地开发/自测显式开(默认关)。生产**永远**不允许开:
 * 这类开关一旦能在生产生效,等于把整个防线做成了一个环境变量。
 */
/**
 * 装了哪些自托管端点 —— **只有这些 env 里逐字写着的 origin** 才允许指向内网。
 *
 * 加新条目前先问一句:这个 env 是**部署者填的**,还是可能被请求内容影响的?
 * 只有前者能进这张表。混进一个后者,这道守卫就等于没有了。
 */
const OPERATOR_ENDPOINT_ENVS = [
  'SELFHOST_VIDEO_URL',   // v12.411 自托管视频
  'MUSIC_SELFHOST_URL',   // v12.410 自托管音乐(ACE-Step / YuE)
  'LIPSYNC_API_URL',      // 自托管口型(wav2lip / SadTalker / MuseTalk)
  'COMFYUI_URL',
] as const;

export function isOperatorConfiguredOrigin(origin: string): boolean {
  if (!origin) return false;
  for (const key of OPERATOR_ENDPOINT_ENVS) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      if (new URL(raw).origin === origin) return true;
    } catch { /* env 里写的不是合法 URL → 不放行 */ }
  }
  return false;
}

export async function assertOutboundUrlSafe(rawUrl: string): Promise<SsrfVerdict> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL 解析失败' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `不允许的协议 ${u.protocol}(仅 http/https)` };
  }

  const allowPrivate =
    process.env.SSRF_ALLOW_PRIVATE === '1' && process.env.NODE_ENV !== 'production';
  if (allowPrivate) return { ok: true };

  // v12.420:**运维显式配置的自托管端点**是唯一合法的内网例外。
  //
  // 病象:v12.411 接了自托管视频端点、v12.410 接了自托管音乐,而两者最自然的地址
  // 就是 `http://localhost:8188/...` —— 结果被这道守卫拒掉,**接了却用不了**。
  // 我在 .env.example 里写的示例正是 localhost,它根本调不通。
  //
  // 为什么不用 SSRF_ALLOW_PRIVATE:那是**全局**开关且生产禁用 ——
  // 为一条端点把整道防线撤掉,是拿一个真实的安全边界换一个功能,不划算。
  //
  // 这里的例外窄到只有一种形态:**origin 必须逐字出现在下面这几个 env 里**。
  // SSRF 防的是「URL 来自不可信内容」,而这些 env 是部署者自己填的 ——
  // 两者性质不同。而且判据落在 env 上,任何从请求内容里冒出来的 origin
  // 都不可能命中它,所以放行面不会因为调用方写错而扩大。
  if (isOperatorConfiguredOrigin(u.origin)) {
    return { ok: true };
  }

  const host = normalizeHost(u.hostname);

  // 明确的本机别名 —— 这些不一定解析成 IP 字面量,但语义就是「打我自己」
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: `内网主机名被拒:${u.hostname}` };
  }
  // 云厂商元数据域名(GCP 的 metadata.google.internal 已被上面 .internal 覆盖,这里补其余)
  if (host === 'metadata' || host === 'instance-data') {
    return { ok: false, reason: `云元数据主机名被拒:${u.hostname}` };
  }

  if (net.isIP(host)) {
    return isBlockedIp(host)
      ? { ok: false, reason: `内网/保留地址被拒:${host}` }
      : { ok: true };
  }

  // 域名 → 必须真解析。解析不出来就拒(宁可误杀,也不放一个解析行为不明的目标出去)
  let addrs: string[];
  try {
    const res = await dns.lookup(host, { all: true, verbatim: true });
    addrs = res.map((r) => r.address);
  } catch (e) {
    return { ok: false, reason: `DNS 解析失败:${e instanceof Error ? e.message : 'unknown'}` };
  }
  if (addrs.length === 0) return { ok: false, reason: 'DNS 无解析结果' };

  // 任一解析地址落在内网就整体拒 —— 多 A 记录里混一个 127.0.0.1 是经典绕过手法
  const bad = addrs.find((a) => isBlockedIp(a));
  if (bad) {
    // v12.242:把**全部**解析结果一并报出 —— 实测在 DNS 被污染的网络里,
    // 合法域名可能被解析到奇怪地址(本机上 www.google.com 就解析出 2001::1),
    // 只说「解析到内网地址」会让人以为是守卫抽风,列出全部结果才能一眼看出是 DNS 的问题。
    return { ok: false, reason: `域名 ${u.hostname} 的解析结果含不可出站地址 ${bad}(全部:${addrs.join(', ')})` };
  }

  return { ok: true };
}

/**
 * v12.235 —— 带 SSRF 校验的 fetch,**逐跳重验重定向**。
 *
 * 上一版(v12.234)刚写完 `assertOutboundUrlSafe` 就自查出一个致命缺口:
 * 它只校验**初始 URL**,而 Node/undici 的 `fetch` 默认 `redirect: 'follow'` ——
 * 攻击者只要给一个自己控制的公网地址,让它 302 到 `http://169.254.169.254/...`,
 * 守卫全程放行,云 IAM 凭证照样被代理回来。**整道防线等于没做。**
 *
 * 又是同一个病:写了「解析层」的守卫,却没跟到「真正发请求」的消费方。
 * 所以这里不再让调用方自己 fetch,而是提供唯一入口:redirect 设 manual,
 * 每跳的 Location 都重新过一遍 assertOutboundUrlSafe,跳数封顶。
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let url = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const verdict = await assertOutboundUrlSafe(url);
    if (!verdict.ok) {
      throw new Error(
        hop === 0
          ? `SSRF 拦截:${verdict.reason}`
          : `SSRF 拦截(第 ${hop} 跳重定向):${verdict.reason}`,
      );
    }

    const resp = await fetch(url, { ...init, redirect: 'manual' });
    if (resp.status < 300 || resp.status >= 400) return resp;

    const loc = resp.headers.get('location');
    if (!loc) return resp; // 3xx 但没给 Location —— 原样交回,由调用方处理
    // 相对跳转要按当前 URL 解析,否则 `/latest/meta-data` 这种相对路径会被漏判
    url = new URL(loc, url).toString();
  }
  throw new Error(`SSRF 拦截:重定向超过 ${maxRedirects} 跳`);
}
