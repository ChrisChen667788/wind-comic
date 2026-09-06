/**
 * v12.425 真机抓图 —— 各类资产 + 导演台/创作过程。
 *
 * 跑法:dev server 在 :3000(JWT_SECRET 与本脚本同)→ `node scripts/capture-v12-425.mjs`
 *
 * 鉴权:不走密码登录 —— 用 JWT_SECRET mint 会话令牌。**cookie 和 localStorage 两处都要注**:
 * 服务端是「Bearer 优先、会话 cookie 兜底」双读,而项目页那条取数 fetch 不带 Bearer 头,
 * 只注 localStorage 会得到 401 + 页面显示「项目不存在」,看着像数据没了。(v12.416 踩过)
 *
 * 标签切换:v12.416 的脚本里记了一条「点 tab 和滚 body 都不改变视图」的死路 —— **那条是错的**。
 * 真因是标签栏在折叠线以下,坐标点击打空。先 `scrollIntoView` 再 `el.click()` 就能切,
 * 本脚本 17 张里有 12 张靠它。旧结论已从 README 撤下。
 *
 * 选材:本机 data/qfmj.db 里不少素材的底层文件已被那次定时清理删掉(角色库 44 张立绘活 5 张),
 * 抓图前用 .tools/health.mjs 量过活性,只挑素材健在的项目 —— 截图里不该出现「素材已失效」。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000';
const OUT = path.join(process.cwd(), 'assets', 'v12-425');
const DB = path.join(process.cwd(), 'data', 'qfmj.db');
/** 素材完整、四类资产俱全的演示工程;角色转身图取宿命之柱(4 张全活)。 */
const SHOWCASE = 'qfmj-demo-showcase';
const CHARS = 'proj-1781164723524';   // 绿皮书之约:3 张转身图全活、无第三方水印
const CHARS2 = 'proj-1780686289776';  // 月挂不下来:另一组角色 + 有配乐资产
const BUSY = 'proj-1781368728491';    // 宿命之柱:22 分镜 / 11 镜头视频,导演台数据最足

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnvLocal(key) {
  try {
    const m = fs.readFileSync('.env.local', 'utf-8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

function mintSession() {
  const secret = process.env.JWT_SECRET || readEnvLocal('JWT_SECRET');
  if (!secret) throw new Error('没读到 JWT_SECRET(env 或 .env.local)');
  const db = new Database(DB, { readonly: true });
  const u = db.prepare(
    'select u.* from users u join projects p on p.user_id = u.id group by u.id order by count(p.id) desc limit 1'
  ).get();
  db.close();
  if (!u) throw new Error('库里没有带项目的用户');
  return {
    token: jwt.sign({ sub: u.id, role: u.role || 'member' }, secret, { expiresIn: '6h' }),
    user: { id: u.id, email: u.email, name: u.name, role: u.role || 'member', avatarUrl: u.avatar_url || '', locale: 'zh' },
  };
}

const ok = [], skipped = [];
const seenHashes = new Map();
const sameUrlShots = new Map();

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
    || (fs.existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined);
  const browser = await puppeteer.launch({
    headless: 'new', args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1500, deviceScaleFactor: 2 });

  const { token, user } = mintSession();
  await page.evaluateOnNewDocument(([t, u]) => {
    localStorage.setItem('qfmj-token', t);
    localStorage.setItem('qfmj-user', u);
    localStorage.setItem('qfmj-create-guide-done', '1');   // 首次引导浮层会压暗整页
  }, [token, JSON.stringify(user)]);
  await page.setCookie({ name: 'qfmj-session', value: token, domain: new URL(BASE).hostname, path: '/', httpOnly: false });
  console.log('[capture] session ->', user.email);

  /** 按可见文本点一个控件;先滚进视口,否则折叠线以下的点击会打空。 */
  const clickText = (re) => page.evaluate((src) => {
    const rx = new RegExp(src);
    const el = Array.from(document.querySelectorAll('button,[role="tab"],a'))
      .find((e) => rx.test((e.innerText || '').trim()));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, re.source ?? re);

  /**
   * 把某段文字所在的控件滚到「距视口顶 targetY 像素」处。
   *
   * 不能用 scrollIntoView + 手工补偏移:前者滚的是文档,后者常加在另一个祖先容器上,
   * 两个滚动目标打架,结果就是滚了但没滚到位(第一版分组栏停在 45% 高度)。
   * 这里先找到真正在滚的那个祖先,再一次性把差值加上去。
   *
   * 要跑两遍:时间线/拉片是 dynamic import 懒加载的,第一遍滚完组件才挂载,
   * 页面高度一变,刚才的 scrollTop 就指到别处了。
   */
  const scrollTo = async (re, targetY = 96) => {
    const src = re.source ?? re;
    let done = false;
    for (let pass = 0; pass < 2; pass++) {
      done = await page.evaluate(([rxSrc, ty]) => {
        const rx = new RegExp(rxSrc);
        const el = Array.from(document.querySelectorAll('button,[role="tab"],a,h1,h2,h3'))
          .find((e) => rx.test((e.innerText || '').trim()));
        if (!el) return false;
        // 先用 scrollIntoView 把元素带到容器顶部 —— 它不关心谁是滚动容器,总能生效。
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
        // 再补 targetY 的余量,让元素从吸顶页头下面露出来。
        // 滚动容器是**试出来的**:这个页面 html/body 都不滚,滚的是中间某个 div,
        // 靠 class 猜或默认 document.scrollingElement 都会静默失效(试过,滚了等于没滚)。
        let n = el.parentElement;
        while (n) {
          const before = n.scrollTop;
          n.scrollTop = before + 1;
          if (n.scrollTop !== before) { n.scrollTop = before; break; }
          n = n.parentElement;
        }
        const sc = n || document.scrollingElement;
        sc.scrollTop -= ty;
        return true;
      }, [src, targetY]);
      if (!done) return false;
      await sleep(1800);   // 时间线/拉片是懒加载的,挂载后页面高度会变,得再滚一遍
    }
    return done;
  };

  /**
   * 算出「从某段文字所在的面板顶部,到内容结束」的取景框。
   *
   * 为什么需要:项目页在标签内容之上恒定挂着 CAMEO 上传位 + 角色档案三个空槽,
   * 谁也滚不掉 —— 直接截屏,功能面板永远只占下半屏。截图是给人看功能的,
   * 就该对着功能取景;这是取景,不是修图,像素一个没动过。
   *
   * ⚠️ 坐标系:必须配 captureBeyondViewport:false。puppeteer 默认按文档坐标裁,
   * 而这里给的是 getBoundingClientRect() 的视口坐标 —— 页面滚过之后两者错位,
   * 会把 sticky 页头拍进画面中间(第一版 08-character-sheets 就是这么废的)。
   */
  const clipOf = (re, padTop = 24) => page.evaluate(([src, pad]) => {
    const rx = new RegExp(src);
    const el = Array.from(document.querySelectorAll('button,[role="tab"],a,h1,h2,h3'))
      .find((e) => rx.test((e.innerText || '').trim()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = Math.max(0, r.top - pad);
    // 下沿跟到最后一块真实内容,别把半屏空白也裁进来。
    // 排除 fixed/sticky:右下角那颗客服气泡是 fixed,不排除的话它把框一直撑到屏底。
    let bottom = top + 240;
    for (const e of document.querySelectorAll('div,section,table,ul')) {
      const pos = getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') continue;
      const b = e.getBoundingClientRect();
      if (b.width < 200 || b.top < top) continue;
      if (b.bottom > bottom && b.bottom <= window.innerHeight) bottom = b.bottom;
    }
    return { x: 0, y: top, width: window.innerWidth,
             height: Math.min(window.innerHeight - top, bottom - top + pad) };
  }, [re.source ?? re, padTop]);

  /**
   * 对着「含某段文字的那个弹窗」取景 —— 弹窗四周大片空白,直接截屏浪费画面。
   *
   * 优先认 `[role="dialog"]`:按文字找最小容器会命中弹窗内部的某一段,
   * 把标题和底部按钮切掉(第一版 09 就是这么废的)。左右各留一段背景做上下文,
   * 免得裁成一条又窄又长的纸带。
   */
  const clipPanel = (needle, pad = 24, side = 300) => page.evaluate(([n, p2, sd]) => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter((d) => (d.innerText || '').includes(n) && d.getBoundingClientRect().height > 200);
    const hit = dialogs[0] || Array.from(document.querySelectorAll('div'))
      .filter((d) => (d.innerText || '').includes(n))
      .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)
      .find((d) => d.getBoundingClientRect().height > 260);
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    const x = Math.max(0, r.left - sd);
    const y = Math.max(0, r.top - p2);
    return {
      x, y,
      width: Math.min(window.innerWidth - x, r.width + sd * 2),
      height: Math.min(window.innerHeight - y, r.height + p2 * 2),
    };
  }, [needle, pad, side]);

  const shot = async (name, url, opts = {}) => {
    try {
      if (page.url() !== url) {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(opts.load ?? 9000);
      }
      for (const step of opts.steps || []) {
        let done;
        if (step.type) {
          const box = await page.$('input[placeholder*="搜索"]');
          if (box) { await box.click(); await box.type(step.type); done = true; } else done = false;
        } else if (step.clickCard) {
          done = await page.evaluate((name) => {
            const cards = Array.from(document.querySelectorAll('div'))
              .filter((d) => (d.innerText || '').includes(name) && String(d.className).includes('group'));
            const c = cards[cards.length - 1];
            if (!c) return false; c.click(); return true;
          }, step.clickCard);
        } else {
          done = await (step.click ? clickText(step.click) : scrollTo(step.anchor, step.targetY));
        }
        if (!done && step.required !== false) { skipped.push(`${name}(找不到「${step.click || step.anchor}」)`); return; }
        await sleep(step.wait ?? 5000);
      }
      const text = await page.evaluate(() => (document.body.innerText || '').trim());
      if (text.length < 40) { skipped.push(`${name}(正文仅 ${text.length} 字,判为未渲染)`); return; }
      const textHash = crypto.createHash('md5').update(text).digest('hex');

      const f = path.join(OUT, `${name}.png`);
      const clip = opts.clipPanel ? await clipPanel(opts.clipPanel)
        : opts.clipFrom ? await clipOf(opts.clipFrom, opts.clipPad) : null;
      if ((opts.clipFrom || opts.clipPanel) && !clip) {
        skipped.push(`${name}(取景锚点「${opts.clipFrom || opts.clipPanel}」没找到)`); return;
      }
      await page.screenshot({ path: f,
        ...(clip ? { clip, captureBeyondViewport: false } : { fullPage: !!opts.fullPage }) });
      const buf = fs.readFileSync(f);
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      if (seenHashes.has(hash)) {
        fs.unlinkSync(f); skipped.push(`${name}(与 ${seenHashes.get(hash)} 字节完全相同,已删除)`); return;
      }
      // 「点了 tab 但视图没变」的判据:同一 URL 下**可见文本一字不差**。
      //
      // 判据换过两版,两版都栽在同一个地方 —— 拿 PNG 字节数当相似度:
      //   · v12.416 跨页面比体积,把真正不同的几张误杀;
      //   · 本轮改成同页面比体积(<0.2%),又把素材库的「剧本」当成「配乐」的重复删了
      //     —— 两页都是纯图标网格,像素只差几个字形。
      //   · 收紧成「体积 + 文本」双条件后更糟:体积每轮有抖动,同一个 no-op 上一轮抓住、
      //     下一轮放过 —— 一道时灵时不灵的门禁比没有还坏。
      // 字节数从来不是相似度。文本才是:tab 没切成文本必然一字不变,真切了则标签、
      // 条目名、计数都会变。确需「同文本不同滚动位」的两张,显式传 allowSameText。
      const prevs = sameUrlShots.get(url) || [];
      for (const prev of prevs) {
        if (prev.text === textHash && !opts.allowSameText) {
          fs.unlinkSync(f);
          skipped.push(`${name}(与 ${prev.name} 同页面且可见文本完全一致 —— 交互没生效,已删除)`);
          return;
        }
      }
      prevs.push({ name, text: textHash }); sameUrlShots.set(url, prevs);
      seenHashes.set(hash, name); ok.push(f);
      console.log('  ✓', path.basename(f));
    } catch (e) {
      skipped.push(`${name}(${e.message.slice(0, 70)})`);
    }
  };

  // ── 一、素材库:逐类资产真机图 ────────────────────────────────
  const ASSETS = `${BASE}/dashboard/assets`;
  await shot('01-assets-all', ASSETS, { load: 12000 });
  for (const [n, label] of [['02-assets-character', '角色'], ['03-assets-scene', '场景'],
                            ['04-assets-storyboard', '分镜'], ['05-assets-video', '视频'],
                            ['06-assets-music', '配乐'], ['07-assets-script', '剧本']]) {
    await shot(n, ASSETS, { steps: [{ click: new RegExp(`^${label}\\s*\\(\\d+\\)$`), wait: 6000 }] });
  }

  // ── 二、角色资产:项目内转身图 + 跨项目角色库 ──────────────────
  await shot('08-character-sheets', `${BASE}/projects/${CHARS}`, {
    steps: [{ click: /^角色\s*\d*$/, wait: 7000 }, { anchor: /^创作\s*CREATE$/, targetY: 96, wait: 2000 }],
      clipFrom: /^创作\s*CREATE$/, clipPad: 20,
  });
  await shot('08b-character-sheets-2', `${BASE}/projects/${CHARS2}`, {
    load: 11000,
    steps: [{ click: /^角色\s*\d*$/, wait: 7000 }, { anchor: /^创作\s*CREATE$/, targetY: 96, wait: 2000 }],
    clipFrom: /^创作\s*CREATE$/, clipPad: 20,
  });
  await shot('09-character-dossier', `${BASE}/dashboard/characters`, {
    load: 12000,
    steps: [{ type: '柳如烟', wait: 4000 }, { clickCard: '柳如烟', wait: 6000 }],
    clipPanel: '外貌特征',
  });
  // 网格那张留着,但它是「素材已失效」兜底的实例:本机 44 张立绘的底层文件被那次
  // 定时清理删了 41 张 —— 修前 onError 直接 display:none,卡片变一片空白。
  await shot('09b-character-library', `${BASE}/dashboard/characters`, { load: 12000, allowSameText: true });

  // ── 三、导演台 / 创作过程 ────────────────────────────────────
  const SHOW = `${BASE}/projects/${SHOWCASE}`;
  await shot('10-director-console', `${BASE}/projects/${BUSY}`, {
    load: 11000,
    steps: [{ click: /^导演台$/, wait: 7000 }, { anchor: /^创作\s*CREATE$/, targetY: 96, wait: 2000 }],
      clipFrom: /^创作\s*CREATE$/, clipPad: 20,
  });
  await shot('11-oneclick-film', `${BASE}/projects/${BUSY}`, {
    steps: [{ click: /^一键成片$/, wait: 7000 }, { anchor: /^创作\s*CREATE$/, targetY: 96, wait: 2000 }],
      clipFrom: /^创作\s*CREATE$/, clipPad: 20,
  });
  await shot('12-creation-workshop', `${BASE}/dashboard/create`, { load: 13000 });

  // ── 四、专业能力:分镜规格 / 拉片 / 时间线 / 节奏 / 视频 ────────
  await shot('13-storyboard-specs', SHOW, {
    steps: [{ click: /^分镜\s*\d*$/, wait: 7000 }, { anchor: /^创作\s*CREATE$/, targetY: 96, wait: 2000 }],
      clipFrom: /^创作\s*CREATE$/, clipPad: 20,
  });
  await shot('14-videos', SHOW, {
    steps: [{ click: /^视频\s*\d*$/, wait: 8000 }, { anchor: /^创作\s*CREATE$/, targetY: 96, wait: 2000 }],
      clipFrom: /^创作\s*CREATE$/, clipPad: 20,
  });
  await shot('15-pull-sheet', SHOW, {
    steps: [{ click: /^审校/, wait: 3000 }, { click: /^拉片$/, wait: 8000 }, { anchor: /^审校\s*REVIEW$/, targetY: 96, wait: 2000 }],
      clipFrom: /^审校\s*REVIEW$/, clipPad: 20,
  });
  await shot('16-cinema-timeline', SHOW, {
    steps: [{ click: /^精修/, wait: 3000 }, { click: /^Cinema 时间线/, wait: 9000 }, { anchor: /^精修\s*REFINE$/, targetY: 96, wait: 2000 }],
      clipFrom: /^精修\s*REFINE$/, clipPad: 20,
  });
  await shot('17-pacing', `${BASE}/projects/${BUSY}`, {
    steps: [{ click: /^审校/, wait: 3000 }, { click: /^节奏分析\s*\d*$/, wait: 8000 }, { anchor: /^审校\s*REVIEW$/, targetY: 96, wait: 2000 }],
      clipFrom: /^审校\s*REVIEW$/, clipPad: 20,
  });

  await browser.close();

  // 转 JPEG 并降到 1600px 宽:@2x 的 PNG 一共 50MB,进仓会顶穿 preflight 的媒体预算门禁。
  // 用系统 sips(macOS 自带),不引依赖。转失败就保留 PNG 并如实说,不假装成功。
  let converted = 0;
  for (const f of ok) {
    const jpg = f.replace(/\.png$/, '.jpg');
    try {
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72',
                            '--resampleWidth', '1600', f, '--out', jpg], { stdio: 'ignore' });
      fs.unlinkSync(f); converted++;
    } catch {
      skipped.push(`${path.basename(f)} 转 JPEG 失败,保留 PNG`);
    }
  }

  console.log(`\n出图 ${ok.length} 张(转 JPEG ${converted} 张)→ ${path.relative(process.cwd(), OUT)}`);
  if (skipped.length) {
    console.log(`如实跳过 ${skipped.length} 张:`);
    for (const s of skipped) console.log('  ·', s);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
