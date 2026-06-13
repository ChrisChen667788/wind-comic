/**
 * 截 v11.x–v12.x 新增/改动界面 → docs/screenshots/v12/。
 * 跑法:dev server 在 :3000 跑着 → `node scripts/capture-v12.mjs`
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = 'docs/screenshots/v12';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // 登录(注入 token)
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const login = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@qfmanju.ai', password: 'Qfmanju123' }),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const d = await r.json();
    localStorage.setItem('qfmj-token', d.token);
    localStorage.setItem('qfmj-user', JSON.stringify(d.user));
    return { ok: true };
  });
  console.log('[v12] login:', login);
  if (!login.ok) { await browser.close(); process.exit(1); }

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

  await browser.close();
  console.log('[v12] done →', OUT);
})().catch((e) => { console.error('[v12] FAIL:', e.message); process.exit(1); });
