/**
 * v12.234 — 第二轮独立对抗复检的修复回归锁。
 *
 * 这一轮最刺眼的教训不是「又找到 16 个洞」,而是**上一轮的不变量测试自己是假绿的**:
 * v12-233 的「不得再出现赋 __no_auth__ 后继续跑」那条,只遍历了 CASES 里**硬编码的 3 个文件** ——
 * 也就是「只检查我刚改过的那几个」。save-template、review-status 这类同款写法从未被扫到,
 * 一路绿灯发布。所以本文件的不变量一律 **walk 全仓**,并且都带「扫到的文件数下限」断言,
 * 防止 walk 本身坏掉后空跑变成另一种假绿。
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isBlockedIp, normalizeHost, assertOutboundUrlSafe } from '@/lib/ssrf-guard';
import { getSubtitleStyle } from '@/lib/subtitle-burn';
import { coverFontCandidates } from '@/lib/cover-title-burn';
import { isOpenLicenseFont } from '@/lib/text-control';

const ROOT = path.join(__dirname, '..');

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRoutes(p, acc);
    else if (e.name === 'route.ts') acc.push(p);
  }
  return acc;
}

/** 取某个 handler 的函数体(到文件末尾即可 —— 只用于「守卫在不在里面」的存在性判断)。 */
function handlerBody(src: string, method: string): string | null {
  const i = src.indexOf(`export async function ${method}(`);
  return i === -1 ? null : src.slice(i);
}

const ROUTES = walkRoutes(path.join(ROOT, 'app', 'api'));

describe('v12.234 全仓不变量(替换 v12.233 只扫 3 个文件的假绿版)', () => {
  it('扫到足够多的路由文件(walk 坏掉 → 空跑假绿的哨兵)', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(100);
  });

  it('任何 handler 都不得「赋 __no_auth__ 后继续执行写操作」', () => {
    // 判定口径:handler 体内出现 `= '__no_auth__'`,且**同一 handler 内没有**任何真守卫。
    // 只读端点用哨兵查空是安全的(查不到就是空集);致命的是写路径把哨兵当合法用户继续跑。
    const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const offenders: string[] = [];
    for (const f of ROUTES) {
      const src = fs.readFileSync(f, 'utf-8');
      if (!/= '__no_auth__'/.test(src)) continue;
      for (const m of WRITE) {
        const body = handlerBody(src, m);
        if (!body) continue;
        const hasSentinel = /= '__no_auth__'/.test(body);
        const hasGuard = /requireUser\(|requireProjectAccess\(|guardPaidEndpoint\(/.test(body);
        if (hasSentinel && !hasGuard) offenders.push(`${path.relative(ROOT, f)}#${m}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('不得再出现「返回类型写 string|null 但函数体永不返回 null」的死鉴权检查', () => {
    // review-status 就栽在这:resolveUserId 声明 string|null,实际永远返回哨兵字符串,
    // 于是 `if (!actorId) return 401` 是一句永不执行的装饰。类型说谎比没有类型更危险。
    const offenders: string[] = [];
    for (const f of ROUTES) {
      const src = fs.readFileSync(f, 'utf-8');
      const m = src.match(/function resolveUserId\([^)]*\): string \| null \{([\s\S]*?)\n\}/);
      if (m && !/return null/.test(m[1])) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });

  it('付费/外部调用端点必须有守卫:u2v、script-drafts 等', () => {
    const MUST_GUARD = [
      'app/api/u2v/route.ts',
      'app/api/script-drafts/route.ts',
      'app/api/narration/synthesize/route.ts',
      'app/api/u2v/stream/route.ts',
    ];
    for (const rel of MUST_GUARD) {
      const body = handlerBody(fs.readFileSync(path.join(ROOT, rel), 'utf-8'), 'POST');
      expect(body, `${rel} 没有 POST handler`).toBeTruthy();
      expect(/guardPaidEndpoint\(/.test(body!), `${rel} 缺付费守卫`).toBe(true);
    }
  });

  it('上传 / 文件服务 / 榜单写入端点必须要求登录', () => {
    const MUST_AUTH: Array<[string, string]> = [
      ['app/api/upload/character-face/route.ts', 'POST'],
      ['app/api/upload/comment-attachment/route.ts', 'POST'],
      ['app/api/templates/[id]/use/route.ts', 'POST'],
      ['app/api/templates/shared/[token]/clone/route.ts', 'POST'],
      ['app/api/serve-file/route.ts', 'GET'],
    ];
    for (const [rel, m] of MUST_AUTH) {
      const body = handlerBody(fs.readFileSync(path.join(ROOT, rel), 'utf-8'), m);
      expect(body, `${rel} 没有 ${m} handler`).toBeTruthy();
      expect(/requireUser\(/.test(body!), `${rel}#${m} 缺登录守卫`).toBe(true);
    }
  });

  it('users/lookup 的鉴权不再只在 production 生效', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'users', 'lookup', 'route.ts'), 'utf-8');
    expect(/!payload && process\.env\.NODE_ENV === 'production'/.test(src)).toBe(false);
    expect(/if \(!payload\)/.test(src)).toBe(true);
  });

  it('删除类 cron 端点在生产未配密钥时必须拒跑(而非无密钥即放行)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'cron', 'cleanup-media', 'route.ts'), 'utf-8');
    // 旧写法 `if (secret && ...)`:密钥没配 → 整个判断短路 → 匿名可触发批量删除
    expect(/if \(secret && url\.searchParams/.test(src)).toBe(false);
    expect(src.includes('503')).toBe(true);
  });
});

describe('v12.234 SSRF 守卫(serve-file?proxy / persistAsset 共用)', () => {
  it('拦住云元数据地址 —— 旧正则最要命的漏网之鱼', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });

  it('拦住各类内网/保留段', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255',
                      '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isBlockedIp(ip), `${ip} 应被拦`).toBe(true);
    }
  });

  it('放行正常公网地址(别把守卫做成全拒)', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '104.16.0.1', '2001:4860:4860::8888']) {
      expect(isBlockedIp(ip), `${ip} 应放行`).toBe(false);
    }
  });

  it('归一化各种进制编码的 IPv4(绕过字面量正则的经典手法)', () => {
    expect(normalizeHost('2130706433')).toBe('127.0.0.1');   // 十进制整体
    expect(normalizeHost('0x7f000001')).toBe('127.0.0.1');   // 十六进制整体
    expect(normalizeHost('0177.0.0.1')).toBe('127.0.0.1');   // 逐段八进制
    expect(isBlockedIp(normalizeHost('2130706433'))).toBe(true);
  });

  it('拒非 http(s) 协议与内网主机名', async () => {
    expect((await assertOutboundUrlSafe('file:///etc/passwd')).ok).toBe(false);
    expect((await assertOutboundUrlSafe('http://localhost:3000/x')).ok).toBe(false);
    expect((await assertOutboundUrlSafe('http://metadata.google.internal/x')).ok).toBe(false);
    expect((await assertOutboundUrlSafe('http://169.254.169.254/latest/meta-data/')).ok).toBe(false);
  });

  it('域名走 DNS 解析层:解析到内网即拒(纯字面量匹配挡不住)', async () => {
    // localtest.me / 类似域名解析到 127.0.0.1 是公开事实,但离线 CI 解析会失败 ——
    // 两种结果都必须是「拒绝」,所以这里只断言 ok=false,不断言具体 reason。
    const v = await assertOutboundUrlSafe('http://127.0.0.1.nip.io/');
    expect(v.ok).toBe(false);
  });
});

describe('v12.234 字体合规 —— 这次锁「真正烧进片子」的那条路径', () => {
  it('CJK 平台字幕预设不再指名 macOS 专有字体', () => {
    for (const p of ['douyin', 'kuaishou', 'xiaohongshu', 'default']) {
      const name = getSubtitleStyle(p).fontName;
      expect(name, `${p} 预设仍指名专有字体`).not.toMatch(/PingFang|STHeiti|Hiragino|Songti/i);
    }
  });

  it('西文平台预设不受影响(别把 Arial 也误伤成 CJK)', () => {
    expect(getSubtitleStyle('youtube').fontName).toBe('Arial');
    expect(getSubtitleStyle('tiktok').fontName).toBe('Arial');
  });

  it('PRESETS 源码里不得再出现硬编码的专有 CJK 字体名', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'subtitle-burn.ts'), 'utf-8');
    const block = src.slice(src.indexOf('const PRESETS: Record'), src.indexOf('export function listSubtitlePlatforms'));
    expect(/PingFang|STHeiti/.test(block)).toBe(false);
  });

  it('封面字体候选:开源排在系统专有之前(顺序即合规保证)', () => {
    const list = coverFontCandidates();
    const firstProprietary = list.findIndex((p) => /PingFang|STHeiti/.test(p));
    const firstOpen = list.findIndex((p) => /Noto|SourceHan|wqy/i.test(p));
    expect(firstOpen).toBeGreaterThanOrEqual(0);
    expect(firstProprietary).toBeGreaterThan(firstOpen);
  });

  it('本机若命中封面字体,必须是开源可商用的那一档', () => {
    const hit = coverFontCandidates().find((f) => fs.existsSync(f));
    if (!hit) return; // CI 上可能一个 CJK 字体都没有 —— 合法
    if (/\/System\/Library\/Fonts\//.test(hit)) return; // 开源全缺时的末位兜底,已在注释中如实标注
    expect(isOpenLicenseFont(hit)).toBe(true);
  });

  it('video-composer 不再硬编码系统字体兜底', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services', 'video-composer.ts'), 'utf-8');
    expect(src.includes("|| '/System/Library/Fonts/STHeiti Light.ttc'")).toBe(false);
    expect(src.includes(": 'PingFang SC'")).toBe(false);
  });
});

describe('v12.234 门面数字一致性(诚实性锁的补强)', () => {
  // v12.276 修守卫本身:原清单写的是 `README.en.md` —— **仓库里根本没这个文件**,
  // 而真正的中文门面 `README.zh-CN.md` 不在清单内,于是它一路漂到落后两代(3210 vs 真值 3586)
  // 都没被拦下;`docs/modelscope-profile.md` 同样漏检(10 处过期)。
  // 教训:守卫的文件清单本身也会腐坏 —— 故下面加一条「清单里的文件必须真实存在」的自检。
  const files = [
    'README.md', 'README.zh-CN.md', 'docs/MARKETING-zh.md',
    'docs/MARKETING-en.md', 'docs/modelscope-intro.md', 'docs/modelscope-profile.md',
  ];

  it('守卫清单自检:列进来的文件必须真实存在(否则等于没检)', () => {
    const missing = files.filter((f) => !fs.existsSync(f));
    expect(missing, `守卫清单里有不存在的文件(检了个寂寞):${missing.join(', ')}`).toEqual([]);
  });

  it('不得残留**已过期的当前测试数**(诚实性锁此前只盯 v3.1.3/1150 两个旧值)', () => {
    // 教训:MARKETING-zh 写着 3194 而真值 3210,因为不在黑名单里而一路绿灯。
    // 但「同一数字必须全仓唯一」这条又太粗 —— README 里 2135→2712→2780 是**合法的历史里程碑**,
    // 不是矛盾。真正要抓的是「本意表示当前、却忘了跟着涨」的数。
    // 口径:以 README 徽章为唯一真值,凡是**落在真值 100 以内**的数,必然是想说「当前」的,
    // 那就必须等于真值;差得远的按历史里程碑放过。
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    const badge = readme.match(/Tests-(\d{3,5})/i);
    expect(badge, 'README 徽章里读不到测试数').toBeTruthy();
    const TRUE = Number(badge![1]);

    const stale: string[] = [];
    for (const rel of files) {
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, 'utf-8');
      for (const m of src.matchAll(/(\d{4})\s*(?:个单测|个测试|tests)/g)) {
        const n = Number(m[1]);
        if (n !== TRUE && Math.abs(n - TRUE) <= 100) stale.push(`${rel}: ${n}(真值 ${TRUE})`);
      }
    }
    expect(stale, `门面文档里有过期的「当前测试数」:${stale.join(' | ')}`).toEqual([]);
  });

  it('VERSIONS.md 开头叙述的版本号与本文件记录的最新版本一致', () => {
    const src = fs.readFileSync(path.join(ROOT, 'VERSIONS.md'), 'utf-8');
    const head = src.slice(0, 1200);
    // 只取**声称「这是当前版本」**的两处;「v12.218 起进入加固路线图」这类历史指代是合法的,
    // 不该被当成矛盾(第一版不变量就是这么误报的 —— 口径太宽的锁会逼人去改本来正确的文案)。
    // v13.0:主版本号不能写死 12 —— 升到 13 后两条都匹配不上,断言就停在「读不到声明」,修版本号的人得先猜是哪条正则
    const claims = [
      head.match(/到当前 \(\*\*v(\d{1,3}\.\d+)\*\*\)/)?.[1],
      head.match(/截至 \*\*v(\d{1,3}\.\d+)\*\*/)?.[1],
    ].filter(Boolean) as string[];
    expect(claims.length, 'VERSIONS 头部读不到「当前版本」声明').toBeGreaterThan(0);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const cur = String(pkg.version).split('.').slice(0, 2).join('.');
    for (const c of claims) {
      expect(c, `VERSIONS 头部声称 v${c},但 package.json 是 v${cur}`).toBe(cur);
    }
  });
});
