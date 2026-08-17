#!/usr/bin/env node
/**
 * v12.334 — 自采 star 历史曲线,不再依赖任何第三方服务。
 *
 * ── 为什么要自己采 ──────────────────────────────────────────────────
 * GitHub 在 2026-06-30 的 changelog(「Upcoming access restrictions to public API
 * endpoints and UI views」,Notifications 团队)里把 `/repos/{owner}/{repo}/stargazers`
 * **收窄为仅仓库 admin 与 collaborator 可访问**,理由是原文:
 *   "this information has increasingly been misused to collect user data for spam
 *    activities which negatively impacts user experience and platform trust."
 * 同批还砍了 watcher 列表(`/subscribers`),并废弃了 `/users/{username}/subscriptions`。
 *
 * 后果:star-history.com 这类服务对**任何**仓库都是第三方,一律 404 —— 它连自己的仓库
 * 都画不出来。README 里原来那张图现在返回的是一条公告(实测 HTTP 200 但 0 个数据点)。
 *
 * 而 GitHub 关的是「看别人家的」,**没关「看自己家的」**:本机实测用 owner 的 token
 * 能把本仓 419 条 star 时间戳一条不差地取回。Actions 里的 `GITHUB_TOKEN` 天然持有
 * 本仓库身份,所以这条路成立 —— 图存进仓库,从此零外部依赖。
 *
 * ── 为什么不用 OSSInsight 之类的替代品 ─────────────────────────────
 * 实测 `next.ossinsight.io/widgets/.../analyze-repo-stars-history` 能出图(HTTP 200,
 * PNG 1442×812),但**画出来是 7 stars、时间停在 6 月底** —— 而本仓是 419 stars。
 * 它基于 GH Archive,而 GH Archive 的 WatchEvent 自 2025 年中起严重欠采集。
 * 把那张图挂首页等于公开宣称自己只有 7 个 star,比不放更糟。
 *
 * ── 数据保全(这一条是本脚本存在的第二个理由)───────────────────
 * 采到的序列会连同 SVG 一起提交进仓库(`assets/star-history.json`)。于是:
 *   · 万一 GitHub 哪天连 owner 访问也一并限制,最后一次的曲线仍然在仓库里,图照常渲染;
 *   · 抓取失败 / 分页中断时**绝不**用残缺数据覆盖已提交的历史(见 mergeSeries 与似真性门禁)。
 * 「不可逆的远端损失」这类事故我在 ModelScope 上刚犯过一次,这里提前上锁。
 *
 * 用法:
 *   node scripts/gen-star-history.mjs                 # 采集 + 生成(Actions / 本机通用)
 *   node scripts/gen-star-history.mjs --dry-run       # 只采集与打印,不落盘
 *   node scripts/gen-star-history.mjs --repo owner/name
 *   node scripts/gen-star-history.mjs --from-json     # 不联网,仅用已提交的 JSON 重绘 SVG
 *
 * token 取值顺序:GITHUB_TOKEN(Actions 注入)→ GH_TOKEN → `gh auth token`(本机)。
 * **全程不打印 token**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT_DIR = 'assets';
const JSON_PATH = path.join(OUT_DIR, 'star-history.json');
const SVG_LIGHT = path.join(OUT_DIR, 'star-history-light.svg');
const SVG_DARK = path.join(OUT_DIR, 'star-history-dark.svg');

/** 抓取到的总数低于已提交总数的这个比例时,判定为「残缺抓取」并拒绝覆盖。 */
export const PLAUSIBLE_FLOOR = 0.8;

// ── 纯函数区(可单测,不碰网络/磁盘)─────────────────────────────

/**
 * 时间戳列表 → 逐日累计序列。只在**有变化的那天**留点(压缩体积,画图无损)。
 * 返回 [{ d: 'YYYY-MM-DD', c: 累计数 }],按日期升序。
 */
export function buildSeries(timestamps) {
  const days = new Map();
  for (const ts of timestamps) {
    const d = String(ts).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    days.set(d, (days.get(d) || 0) + 1);
  }
  let c = 0;
  return [...days.keys()].sort().map((d) => {
    c += days.get(d);
    return { d, c };
  });
}

/**
 * 合并已提交序列与新抓取序列 —— **抓取失败不许抹掉历史**。
 *
 * 口径:抓取成功时新序列是权威的(它才反映「当前的 stargazer 是谁、何时点的」;
 * 有人取消 star 会直接从列表消失,历史累计值本就会被向下修正,这是所有 star 曲线的固有性质)。
 * 但抓取**残缺**时必须保住旧数据 —— 判据是总数跌破已提交总数的 PLAUSIBLE_FLOOR。
 *
 * @returns { series, total, source: 'api'|'preserved', reason }
 */
export function mergeSeries(committed, fetched, floor = PLAUSIBLE_FLOOR) {
  const prevTotal = committed?.series?.length ? committed.series[committed.series.length - 1].c : 0;
  const newTotal = fetched?.length ? fetched[fetched.length - 1].c : 0;

  if (!fetched?.length) {
    return {
      series: committed?.series || [],
      total: prevTotal,
      source: 'preserved',
      reason: '本次未取到任何 star 数据 —— 保留已提交的历史,不用空序列覆盖',
    };
  }
  if (prevTotal > 0 && newTotal < prevTotal * floor) {
    return {
      series: committed.series,
      total: prevTotal,
      source: 'preserved',
      reason:
        `本次仅取到 ${newTotal},已提交为 ${prevTotal}(跌破 ${Math.round(floor * 100)}%)—— ` +
        `更像分页中断而非真的掉了这么多 star,保留旧数据`,
    };
  }
  return { series: fetched, total: newTotal, source: 'api', reason: '' };
}

/**
 * 纵轴刻度:1/2/5×10^n 里挑一个步长,给出 4~6 档。
 *
 * ⚠️ 顶格必须 **≥ max**。首版是 `for (v = 0; v <= max; v += step)`,于是 419 只画到 400 ——
 * 而 renderSvg 拿最大刻度当 yMax,`py(419)` 就落到绘图区**上方**,曲线末端直接冲进标题区。
 * 这种错在源码里完全看不出来(刻度数组本身「很整齐」),是单测抓出来的。
 */
export function niceTicks(max, target = 5) {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  // star 数是整数,步长不得小于 1 —— 否则小仓库(如只有 1 颗星)会算出 0.2 的步长,
  // 四舍五入后刻度变成 0,0,0,1,1,1 六个重复标签。这是新仓库套用本脚本时的必经路径。
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag);
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step * 0.001; v += step) out.push(Math.round(v));
  return out;
}

/**
 * 横轴刻度:序列起点 + 跨度内每个月 1 号。
 *
 * 起点必须单独给一个刻度 —— 否则首月会整段没有时间参照:本仓从 2026-05-09 起,
 * 而 2026-05-01 落在数据之外(画出去会是负坐标),于是「5 月」一个刻度都没有,
 * 头三周的曲线读者无从定位。起点与下一个月首过近时(<6% 跨度)才省掉,免得标签叠字。
 */
export function monthTicks(series) {
  if (series.length < 2) return series.map((p) => p.d);
  const first = series[0].d, last = series[series.length - 1].d;
  const bounds = [];
  let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
  for (let i = 0; i < 400; i++) {
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d > last) break;
    if (d > first) bounds.push(d);
    m++; if (m > 12) { m = 1; y++; }
  }
  if (!bounds.length) return [first, last];
  const span = dayNum(last) - dayNum(first);
  const gap = dayNum(bounds[0]) - dayNum(first);
  return span > 0 && gap / span < 0.06 ? bounds : [first, ...bounds];
}

/**
 * 刻度文案。`Jun 26` 这种写法会被读成「6 月 26 日」(它本意是 2026 年 6 月)——
 * 所以年份一律写成 `'26` 这种带撇号的形式,且**只在需要区分年份时出现**
 * (首个刻度、以及跨年那一格),其余月份只写月名,保持轴面干净。
 */
export function tickLabels(ticks) {
  return ticks.map((d, i) => {
    const mon = MON[+d.slice(5, 7) - 1];
    const yr = d.slice(2, 4);
    const isMonthStart = d.slice(8) === '01';
    const yearChanged = i === 0 || d.slice(0, 4) !== ticks[i - 1].slice(0, 4);
    if (!isMonthStart) return `${mon} ${+d.slice(8, 10)}${yearChanged && i === 0 ? ` '${yr}` : ''}`;
    return yearChanged ? `${mon} '${yr}` : mon;
  });
}

const THEMES = {
  // 与站点的「影院暗金」体系同源(app/cinema-theme.css),不另起一套配色
  dark: {
    bg: '#0A0908', panel: '#13110F', grid: 'rgba(245,241,234,0.10)', axis: 'rgba(245,241,234,0.22)',
    text: '#F5F1EA', text2: '#B8AC9E', text3: '#968D7D', line: '#C9A35E', fill: 'rgba(201,163,94,0.14)',
  },
  light: {
    bg: '#FBF9F5', panel: '#FFFFFF', grid: 'rgba(20,18,16,0.09)', axis: 'rgba(20,18,16,0.22)',
    text: '#141210', text2: '#4A443C', text3: '#6E665B', line: '#8A6E3F', fill: 'rgba(138,110,63,0.12)',
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 渲染 SVG。**只用呈现属性,不用 <style>、不引外部字体** ——
 * README 里的 SVG 是以图片加载的,外部资源一律被拦;字体也只能给通用族列表。
 */
export function renderSvg({ repo, series, total, updatedAt, stale }, themeName = 'dark') {
  const t = THEMES[themeName] || THEMES.dark;
  const W = 800, H = 400;
  const M = { top: 52, right: 28, bottom: 46, left: 58 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;

  if (!series.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Star history unavailable">`
      + `<rect width="${W}" height="${H}" fill="${t.bg}"/>`
      + `<text x="${W / 2}" y="${H / 2}" fill="${t.text2}" font-size="15" text-anchor="middle" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">No star data yet</text></svg>`;
  }

  const x0 = dayNum(series[0].d), x1 = dayNum(series[series.length - 1].d);
  const span = Math.max(1, x1 - x0);
  const yMax = Math.max(...niceTicks(total));
  const px = (d) => M.left + ((dayNum(d) - x0) / span) * iw;
  const py = (c) => M.top + ih - (c / yMax) * ih;

  const yt = niceTicks(total);
  const grid = yt
    .map((v) => `<line x1="${M.left}" y1="${py(v).toFixed(1)}" x2="${(M.left + iw).toFixed(1)}" y2="${py(v).toFixed(1)}" stroke="${t.grid}" stroke-width="1"/>`
      + `<text x="${M.left - 10}" y="${(py(v) + 4).toFixed(1)}" fill="${t.text3}" font-size="11" text-anchor="end" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${v}</text>`)
    .join('');

  const ticks = monthTicks(series);
  const labels = tickLabels(ticks);
  const xt = ticks
    .map((d, i) =>
      `<line x1="${px(d).toFixed(1)}" y1="${M.top + ih}" x2="${px(d).toFixed(1)}" y2="${M.top + ih + 5}" stroke="${t.axis}" stroke-width="1"/>`
      + `<text x="${px(d).toFixed(1)}" y="${M.top + ih + 20}" fill="${t.text3}" font-size="11" text-anchor="middle" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${esc(labels[i])}</text>`)
    .join('');

  // 阶梯线:star 是离散事件,累计值在事件之间是**平的** —— 用直线连会画出不存在的平滑增长
  const steps = [];
  let prev = null;
  for (const p of series) {
    const X = px(p.d).toFixed(1), Y = py(p.c).toFixed(1);
    if (prev === null) steps.push(`M ${X} ${py(0).toFixed(1)} L ${X} ${Y}`);
    else steps.push(`L ${X} ${prev} L ${X} ${Y}`);
    prev = Y;
  }
  const lastX = px(series[series.length - 1].d).toFixed(1);
  const linePath = steps.join(' ');
  const areaPath = `${linePath} L ${lastX} ${py(0).toFixed(1)} Z`;

  const lastP = series[series.length - 1];
  const foot = stale
    ? `data frozen at ${esc(updatedAt.slice(0, 10))} · GitHub restricted the stargazers API`
    : `updated ${esc(updatedAt.slice(0, 10))} · self-collected, no third-party service`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Star history of ${esc(repo)}: ${total} stars">
<rect width="${W}" height="${H}" fill="${t.bg}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${t.grid}" stroke-width="1" rx="6"/>
<text x="${M.left}" y="28" fill="${t.text}" font-size="16" font-weight="600" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">Star History</text>
<text x="${M.left}" y="44" fill="${t.text2}" font-size="12" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${esc(repo)}</text>
${grid}
<path d="${areaPath}" fill="${t.fill}"/>
<path d="${linePath}" fill="none" stroke="${t.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${lastX}" cy="${py(lastP.c).toFixed(1)}" r="3.5" fill="${t.line}"/>
<line x1="${M.left}" y1="${M.top + ih}" x2="${M.left + iw}" y2="${M.top + ih}" stroke="${t.axis}" stroke-width="1"/>
${xt}
<text x="${W - M.right}" y="${28}" fill="${t.text2}" font-size="12" text-anchor="end" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${total} stars</text>
<text x="${W - M.right}" y="${44}" fill="${t.text3}" font-size="10" text-anchor="end" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${foot}</text>
</svg>
`;
}

// ── 副作用区 ──────────────────────────────────────────────────────

function token() {
  const t = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (t) return t;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' }).trim(); } catch { return ''; }
}

function repoSlug(argv) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (m) return m[1];
  } catch { /* 下面报错 */ }
  throw new Error('无法确定仓库:请设 GITHUB_REPOSITORY 或传 --repo owner/name');
}

/** 分页取全部 stargazer 的 starred_at。任一页失败即抛错 —— 半截数据比没数据更危险。 */
async function fetchStarTimestamps(repo, tok) {
  const out = [];
  for (let page = 1; page <= 400; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github.star+json',
        Authorization: `Bearer ${tok}`,
        'User-Agent': 'wind-comic-star-history',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 404) {
      throw new Error(
        `GitHub 返回 404 —— stargazers 接口自 2026-06-30 起仅 admin/collaborator 可访问。` +
        `本脚本必须以**本仓库自己的** token 运行(Actions 的 GITHUB_TOKEN 即可)。`,
      );
    }
    if (!res.ok) throw new Error(`第 ${page} 页失败:HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const it of arr) if (it?.starred_at) out.push(it.starred_at);
    if (arr.length < 100) break;
  }
  return out;
}

function readCommitted() {
  try { return JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8')); } catch { return null; }
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const fromJson = argv.includes('--from-json');
  const committed = readCommitted();

  let repo, merged, updatedAt;
  if (fromJson) {
    if (!committed?.series?.length) { console.error('[star-history] 没有已提交的 JSON,--from-json 无从下手'); process.exit(2); }
    repo = committed.repo;
    merged = { series: committed.series, total: committed.total, source: 'preserved', reason: '--from-json:仅重绘' };
    updatedAt = committed.updatedAt;
  } else {
    repo = repoSlug(argv);
    const tok = token();
    if (!tok) { console.error('[star-history] 没有可用 token(GITHUB_TOKEN / GH_TOKEN / gh auth token)'); process.exit(2); }
    let fetched = [];
    try {
      fetched = buildSeries(await fetchStarTimestamps(repo, tok));
    } catch (e) {
      // 抓取失败不等于要毁掉历史:有旧数据就原样保留并以 0 退出(Actions 不该因此变红)
      if (committed?.series?.length) {
        console.warn(`[star-history] ⚠️ 抓取失败(${e.message.slice(0, 160)})—— 保留已提交历史,不覆盖`);
        console.log(`[star-history] 保持 ${committed.total} stars @ ${committed.updatedAt}`);
        process.exit(0);
      }
      console.error(`[star-history] 抓取失败且无历史可保:${e.message}`);
      process.exit(1);
    }
    merged = mergeSeries(committed, fetched);
    updatedAt = merged.source === 'api' ? new Date().toISOString() : (committed?.updatedAt || new Date().toISOString());
    if (merged.reason) console.warn(`[star-history] ⚠️ ${merged.reason}`);
  }

  const payload = {
    repo,
    updatedAt,
    total: merged.total,
    note: '自采数据。GitHub 2026-06-30 起把 stargazers 接口收窄为 admin/collaborator 可访问,故第三方 star 曲线服务全部失效;此文件由 scripts/gen-star-history.mjs 用本仓库 token 生成并提交,顺带充当历史备份。',
    series: merged.series,
  };
  const stale = merged.source === 'preserved' && !fromJson;
  const svgD = renderSvg({ repo, series: merged.series, total: merged.total, updatedAt, stale }, 'dark');
  const svgL = renderSvg({ repo, series: merged.series, total: merged.total, updatedAt, stale }, 'light');

  console.log(`[star-history] ${repo} · ${merged.total} stars · ${merged.series.length} 个数据点 · 来源 ${merged.source}`);
  if (dry) {
    console.log(`[star-history] --dry-run:不落盘。首点 ${merged.series[0]?.d} 末点 ${merged.series[merged.series.length - 1]?.d}`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(SVG_DARK, svgD);
  fs.writeFileSync(SVG_LIGHT, svgL);
  console.log(`[star-history] ✅ 已写 ${JSON_PATH} / ${SVG_DARK} / ${SVG_LIGHT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[star-history] 未预期错误:', e?.message || e); process.exit(1); });
}
