/**
 * 截 v11.x–v12.x 新增/改动界面 → docs/screenshots/v12/。
 * 跑法:dev server 在 :3000 跑着(JWT_SECRET 与本脚本同) → `node scripts/capture-v12.mjs`
 * 鉴权:不走密码登录 —— 用 JWT_SECRET mint 一枚会话令牌注入 localStorage(与 e2e 一致)。
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = 'docs/screenshots/v12';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mint demo 会话令牌(免密码:读 demo 用户 + JWT_SECRET 签发,与 dev server 同密钥)
function mintDemoSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'").get();
  db.close();
  const secret = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
  const token = jwt.sign({ sub: u.id, role: u.role }, secret, { expiresIn: '1h' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user };
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // 注入会话令牌(免密码鉴权)
  const { token, user } = mintDemoSession();
  await page.evaluateOnNewDocument(([t, u]) => {
    localStorage.setItem('qfmj-token', t);
    localStorage.setItem('qfmj-user', u);
    localStorage.setItem('qfmj-create-guide-done', '1');
  }, [token, JSON.stringify(user)]);
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('[v12] session injected for', user.email);

  const shot = async (name) => {
    const f = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log('[v12] ✓', f);
  };

  // 1. 我的项目(删除/下架管理 + 已下架筛选)— hover 首卡露出操作
  await page.goto(`${BASE}/dashboard/projects`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(2500);
  const card = await page.$('.cinema-card');
  if (card) { await card.hover(); await sleep(600); }
  await shot('01-my-projects-manage');

  // 2. 素材库(删除管理)
  await page.goto(`${BASE}/dashboard/assets`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(2500);
  await shot('02-my-assets-manage');

  // 3. API 健康 + 模型雷达
  await page.goto(`${BASE}/dashboard/health`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(3000);
  // 触发一次模型雷达扫描以露出卡片
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const scan = btns.find((b) => /扫描最新模型/.test(b.textContent || ''));
    if (scan) scan.click();
  });
  await sleep(4000);
  await shot('03-api-health-model-radar');

  // 4. 拉片 tab(拉片表 + 复刻工作台 + 钩子审计在节奏分析)— 演示工程
  await page.goto(`${BASE}/projects/qfmj-demo-showcase`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await sleep(3000);
  // 点「拉片」tab
  const clicked = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button, a'));
    const t = tabs.find((el) => (el.textContent || '').trim() === '拉片');
    if (t) { t.click(); return true; }
    return false;
  });
  await sleep(2500);
  if (clicked) await shot('04-pull-sheet-replicate');

  // 5. 节奏分析 tab(钩子审计三指标)
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button, a'));
    const t = tabs.find((el) => /节奏分析/.test((el.textContent || '').trim()));
    if (t) t.click();
  });
  await sleep(2000);
  await shot('05-pacing-hook-audit');

  // 6. v12.0.4 一句指令调剪辑风格 picker(创作工坊)— 选中「快节奏燃向」露出高亮态
  await page.evaluate(() => localStorage.setItem('qfmj-create-guide-done', '1'));
  await page.goto(`${BASE}/dashboard/create`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(2500);
  const picked = await page.evaluate(() => {
    const picker = document.querySelector('[data-testid="edit-style-picker"]');
    if (!picker) return false;
    const btn = Array.from(picker.querySelectorAll('button')).find((b) => /快节奏燃向/.test(b.textContent || ''));
    if (btn) btn.click();
    picker.scrollIntoView({ block: 'center' });
    return true;
  });
  await sleep(900);
  if (picked) await shot('06-edit-style-instruction');

  // 7. v12.1.2 预览音频:视频 tab 三态音频徽章 + 每镜「带声试听」开关(演示工程)
  await page.goto(`${BASE}/projects/qfmj-demo-showcase`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  const onVideos = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button, a'));
    const t = tabs.find((el) => /^视频/.test((el.textContent || '').trim()));
    if (t) { t.click(); return true; }
    return false;
  });
  await sleep(2000);
  if (onVideos) {
    // 滚到首个带音频徽章的镜
    await page.evaluate(() => document.querySelector('[data-testid="clip-audio-badge"]')?.scrollIntoView({ block: 'center' }));
    await sleep(700);
    await shot('07-clip-audio-preview');
  }

  await browser.close();
  console.log('[v12] done →', OUT);
})().catch((e) => { console.error('[v12] FAIL:', e.message); process.exit(1); });
