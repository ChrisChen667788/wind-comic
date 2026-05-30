#!/usr/bin/env node
/**
 * v8.3 P6.2 — 抓取 v8 新观感截图 (bento dashboard / 风格画廊 / 模板 AI 图标).
 * 前置: dev server :3000 + demo 用户. 输出: assets/v8/<name>.png
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'assets', 'v8');
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=1512,982'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1512, height: 982, deviceScaleFactor: 2 });

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
  console.log('[v8] login:', login);

  async function shot(route, name, { scrollTo, full = false, wait = 2200 } = {}) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(wait);
    if (scrollTo) {
      await page.evaluate((sel) => {
        const el = [...document.querySelectorAll('*')].find((e) => (e.textContent || '').includes(sel) && e.offsetHeight > 0);
        if (el) el.scrollIntoView({ block: 'start' });
      }, scrollTo);
      await sleep(1200);
    }
    const out = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: out, fullPage: full });
    console.log('  ✓', name, '→', out);
  }

  await shot('/dashboard', 'dashboard-bento', { wait: 2600 });
  await shot('/dashboard/styles', 'style-gallery', { wait: 2600 });
  await shot('/dashboard/create', 'template-icons', { scrollTo: '故事模板库', wait: 2600 });

  await browser.close();
  console.log('[v8] done');
}
main().catch((e) => { console.error(e); process.exit(1); });
