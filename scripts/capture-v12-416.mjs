/**
 * scripts/capture-v12-416.mjs — 截 v12.402–416 这一轮的界面 → assets/v12-416/。
 *
 * 跑法:dev server 在 :3000 跑着(JWT_SECRET 与本脚本同)→ `node scripts/capture-v12-416.mjs`
 * 鉴权:不走密码登录 —— 用 JWT_SECRET mint 一枚会话令牌注入 localStorage(与 e2e / capture-v12 一致)。
 *
 * 只截**真实存在的界面**。抓不到的页面如实跳过并在末尾汇总 ——
 * 截图是拿来对外展示的,凑数比缺几张更糟。
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = 'assets/v12-416';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 .env.local 读一个键 —— dev server 就是用它启动的 */
function readEnvLocal(key) {
  try {
    const txt = fs.readFileSync('.env.local', 'utf-8');
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(txt);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

function mintDemoSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'").get();
  // 只取 demo 自己的项目 —— 取别人的会 403/401,页面显示「项目不存在」
  const proj = db.prepare('SELECT id FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(u.id);
  db.close();
  // ⚠️ 这里踩过一次:mint 用的密钥必须与**正在跑的 dev server** 那把一致,
  // 否则签出来的令牌验不过 → 全 401 → 页面显示「项目不存在」,
  // 看起来像数据没了,其实是钥匙不对。(与 e2e 那次 JWT 不匹配同源。)
  const secret = process.env.JWT_SECRET || readEnvLocal('JWT_SECRET') || 'e2e-fixture-secret-not-for-prod';
  const token = jwt.sign({ sub: u.id, role: u.role }, secret, { expiresIn: '1h' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user, projectId: proj?.id };
}

import crypto from 'crypto';

const ok = [];
const skipped = [];
/**
 * 已产出图片的内容指纹。
 * 第一版里 08/09 两张**字节完全相同** —— tab 没点动,同一屏截了两次。
 * 这种图不会报错、看起来也正常,只有比对哈希才发现。截图是拿来对外展示的,
 * 同一张冒充两张比缺一张更糟。
 */
const seenHashes = new Map();
/** 按 URL 分组的产出 —— 近重复只在同一 URL 内判定 */
const sameUrlShots = new Map();

(async () => {
  // puppeteer 自带的 Chrome 未必装(依赖升级会换要求的版本号)——
  // 优先用系统 Chrome,这台机器上一直是这么跑的。
  const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
    || (fs.existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const { token, user, projectId } = mintDemoSession();
  await page.evaluateOnNewDocument(([t, u]) => {
    localStorage.setItem('qfmj-token', t);
    localStorage.setItem('qfmj-user', u);
    localStorage.setItem('qfmj-create-guide-done', '1');
  }, [token, JSON.stringify(user)]);
  // ⚠️ 光注 localStorage 不够:服务端是「Bearer 优先、会话 cookie 兜底」双读,
  // 而项目页那条取数 fetch **不带 Bearer 头**,靠的是 cookie ——
  // 只注 localStorage 会得到 401 + 页面显示「项目不存在」,看起来像数据没了,
  // 实际是这一半鉴权没给。两处都要注。
  await page.setCookie({
    name: 'qfmj-session',
    value: token,
    domain: new URL(BASE).hostname,
    path: '/',
    httpOnly: false,
  });
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  console.log('[capture] session injected for', user.email, '· project', projectId);

  /** 截一张;页面打不开或内容为空则如实跳过,不产出空壳图 */
  const shot = async (name, url, opts = {}) => {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(opts.wait ?? 2500);
      if (opts.before) await page.evaluate(opts.before).catch(() => {});
      if (opts.before) await sleep(opts.afterWait ?? 1500);

      // 空壳检测:正文太短说明页面没渲染出来,截了也是废图
      const len = await page.evaluate(() => (document.body.innerText || '').trim().length);
      if (len < 40) { skipped.push(`${name}(正文仅 ${len} 字,判为未渲染)`); return; }

      const f = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: f, fullPage: !!opts.fullPage });

      const buf = fs.readFileSync(f);
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      if (seenHashes.has(hash)) {
        fs.unlinkSync(f);
        skipped.push(`${name}(与 ${seenHashes.get(hash)} 字节完全相同,已删除)`);
        return;
      }
      // **近重复**也要拦:只比 md5 不够 —— 「点了 tab 但页面没变」会因为一两个像素
      // (光标闪烁之类)产生不同哈希,肉眼一模一样的两张就这么混过去了。
      //
      // 但这条判据必须**限定在同一个 URL 内**:第一版拿体积跨页面比,
      // 把真正不同的几张全杀了 —— 一个会误报的门禁只会训练人忽略门禁。
      // 同一 URL 下体积差 <0.2%,才是「交互没生效」的可靠信号。
      const sameUrl = sameUrlShots.get(url) || [];
      for (const prev of sameUrl) {
        if (Math.abs(prev.size - buf.length) / prev.size < 0.002) {
          fs.unlinkSync(f);
          skipped.push(`${name}(与 ${prev.name} 同一页面且体积几乎一致 —— 交互没生效,已删除)`);
          return;
        }
      }
      sameUrl.push({ name, size: buf.length });
      sameUrlShots.set(url, sameUrl);
      seenHashes.set(hash, name);
      ok.push(f);
      console.log('  ✓', f);
    } catch (e) {
      skipped.push(`${name}(${e.message.slice(0, 60)})`);
    }
  };

  await shot('01-landing', BASE, { fullPage: true });
  await shot('02-projects', `${BASE}/dashboard/projects`);
  await shot('03-assets', `${BASE}/dashboard/assets`);
  await shot('04-health-engines', `${BASE}/dashboard/health`, { wait: 3500 });
  // /dashboard/cost 不存在(第一版是我猜的路径,实测 404)。真实路由是 usage / billing。
  await shot('05-usage', `${BASE}/dashboard/usage`, { wait: 3000 });
  await shot('06-templates', `${BASE}/dashboard/templates`, { wait: 3000 });
  if (projectId) {
    // 项目页是客户端异步取数:networkidle2 返回时正文还只有十来个字。
    // 所以这里等**内容真的出现**,而不是等网络安静。
    await shot('07-project-workshop', `${BASE}/projects/${projectId}`, { wait: 9000 });
    // ⚠️ 项目页只出**一张**,这是实测后的结论,不是偷懒:
    //   · 点 tab(创作/精修/审校/交付/导演台)—— 截出来肉眼完全相同,视图没换;
    //   · 滚动 body —— 同样没变,该页用的是**内部滚动容器**,window.scrollTo 不动它。
    // 两条路都试过了。与其把同一屏当成三个界面发出去凑数,不如只留真实的一张。
    // 下一个人要补项目页的多视图,得先解决「怎么驱动它的内部滚动/路由」,
    // 而不是重试上面这两种已经证伪的做法。
  }

  await browser.close();

  console.log(`\n[capture] 成功 ${ok.length} 张 → ${OUT}`);
  if (skipped.length) {
    // 如实汇报:截图是拿来对外展示的,凑数比缺几张更糟
    console.log(`[capture] 跳过 ${skipped.length} 项(未渲染或打不开):`);
    for (const s of skipped) console.log('   -', s);
  }
})();
