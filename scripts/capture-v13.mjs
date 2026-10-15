/**
 * v13.0 真机抓图 —— 这一大版本最直观的新能力:导演台俯仰(3D 机位视角 + 平面预览)。
 *
 * 格式条安全框没截:本机 9:16 项目的分镜图都是 v12.467 画幅修复之前出的横图(竖框里上下黑边),拿来当宣传图会自相矛盾。
 *
 * 跑法:dev server 在 :3000(读 .env.local,JWT_SECRET 与本脚本同;建议 MOCK_ENGINES=1)→ `node scripts/capture-v13.mjs`
 *
 * **只看不存**:导演台里换焦距、抬机位、点「对准人物」,都是页面里的临时状态 —— 本脚本不点任何「保存」,
 * 不改这个项目的站位,也就不会把已出的分镜标成待重渲。
 *
 * 鉴权与取景沿用 scripts/capture-v12-425.mjs 的做法(mint 会话令牌,cookie + localStorage 两处都注)。
 * 选材:《宿命之柱》—— 9:16、22 镜分镜、本机分镜素材 11/11 健在(抓图前量过)。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000';
const OUT = path.join(process.cwd(), 'assets', 'v13');
const DB = path.join(process.cwd(), 'data', 'qfmj.db');
const PROJECT = process.env.CAPTURE_PROJECT || 'proj-1781368728491';   // 宿命之柱
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
  const u = db.prepare('select u.* from users u join projects p on p.user_id = u.id where p.id = ?').get(PROJECT);
  db.close();
  if (!u) throw new Error(`库里找不到项目 ${PROJECT} 的所有者`);
  return {
    token: jwt.sign({ sub: u.id, role: u.role || 'member' }, secret, { expiresIn: '2h' }),
    user: { id: u.id, email: u.email, name: u.name, role: u.role || 'member', avatarUrl: u.avatar_url || '', locale: 'zh' },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 2 });
  const { token, user } = mintSession();
  await page.evaluateOnNewDocument(([t, u]) => {
    localStorage.setItem('qfmj-token', t);
    localStorage.setItem('qfmj-user', u);
    localStorage.setItem('qfmj-create-guide-done', '1');
  }, [token, JSON.stringify(user)]);
  await page.setCookie({ name: 'qfmj-session', value: token, domain: new URL(BASE).hostname, path: '/', httpOnly: false });
  const shot = async (name, clip) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, type: 'jpeg', quality: 86, ...(clip ? { clip, captureBeyondViewport: false } : {}) });
    console.log('[capture]', name, clip ? `${Math.round(clip.width)}×${Math.round(clip.height)}` : 'full');
  };
  const clickText = (src) => page.evaluate((s) => {
    const rx = new RegExp(s);
    const el = Array.from(document.querySelectorAll('button,[role="tab"],a')).find((e) => rx.test((e.innerText || '').trim()));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.click(); return true;
  }, src);
  /** 受控 range 输入:走原生 setter + input 事件,React 才认。机高滑杆没有 aria-label,按所在 label 的文字找 */
  const setRange = (label, value) => page.evaluate(([l, v]) => {
    const ranges = Array.from(document.querySelectorAll('[role="dialog"] input[type=range]'));
    const el = l === '机高'
      ? ranges.find((r) => (r.closest('label')?.textContent || '').trim().startsWith('机高'))
      : ranges.find((r) => r.getAttribute('aria-label') === l);
    if (!el) return JSON.stringify(ranges.map((r) => [r.getAttribute('aria-label'), (r.closest('label')?.textContent || '').trim().slice(0, 10), r.min, r.max]));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, [label, value]);
  /** 导演台那个弹窗(页面上还有 agent 侧栏也是 role=dialog,不能取第一个) */
  const stageDialog = () => page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => (d.textContent || '').includes('导演台 · 第')) || null);
  const shotDialog = async (name) => {
    const h = await stageDialog();
    const el = h.asElement();
    if (!el) throw new Error('导演台弹窗不见了');
    // 2x 抓下来是 2048px 宽、两张 ~430K,README 媒体总预算(tests/v12-335)会超;压到 1600px 宽 mozjpeg 82,字仍清楚
    const raw = await el.screenshot({ type: 'jpeg', quality: 92 });
    await sharp(raw).resize({ width: 1600 }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, name));
    console.log('[capture]', name, '(导演台弹窗)');
  };
  // ① 导演台:抬机位 → 对准人物 → 3D 机位视角
  await page.goto(`${BASE}/projects/${PROJECT}`, { waitUntil: 'networkidle2', timeout: 180_000 });
  await sleep(2500);
  if (!(await clickText('^分镜'))) throw new Error('找不到「分镜」标签');
  await sleep(2500);
  const opened = await page.evaluate(() => {
    const b = document.querySelector('[title="导演台 — 拖人摆位、定机位、实时构图体检"]');
    if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true;
  });
  if (!opened) throw new Error('找不到分镜卡上的导演台按钮');
  await page.waitForSelector('[role="dialog"]', { timeout: 60_000 });
  await sleep(2500);
  const hi = await setRange('机高', 2.6);
  if (hi !== true) throw new Error(`找不到机高滑杆;弹窗里的滑杆:${hi}`);
  await sleep(600);
  // 35mm 下 9:16 只有 32° 水平视角,三个人两边会被切;换 24mm 让三人都在画内
  if (!(await clickText('^24mm$'))) throw new Error('找不到 24mm 焦距');
  await sleep(500);
  if (!(await clickText('^对准人物$'))) throw new Error('找不到「对准人物」');
  await sleep(800);
  await clickText('^3D 机位视角$');
  await sleep(3500);
  const view = await page.evaluate(() => document.querySelector('[data-camera-view]')?.textContent);
  console.log('[capture] 机位说法:', view);
  await shotDialog('01-director-stage-3d-tilt.jpg');

  // ② 同一台相机的平面预览(地平线随俯仰上移)
  await clickText('^平面$');
  await sleep(1500);
  await shotDialog('02-director-stage-flat.jpg');
  await page.keyboard.press('Escape');
  await sleep(1200);
  // 万一 Esc 没关上,点弹窗自己的关闭按钮(不点保存)
  await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => (d.textContent || '').includes('导演台 · 第'))?.querySelector('button[aria-label="关闭"]')?.click());
  await sleep(1200);

  await browser.close();
}
main().catch((e) => { console.error('[capture] 失败:', e?.message || e); process.exit(1); });
