#!/usr/bin/env node
/**
 * v6.7 — 抓取 v6.x 新功能真实界面截图 (营销/README 用).
 * 前置: dev server :3000 + data/qfmj.db 有 demo 用户 + 富项目.
 * 输出: assets/v6/<name>.png
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'assets', 'v6');
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:3000';

// 富项目: 优先带 narration 的 (展示时间线解说轨), 否则资产最多的
function pickProjects() {
  const db = new Database(path.join(root, 'data', 'qfmj.db'), { readonly: true });
  const demo = db.prepare(`SELECT id FROM users WHERE email='demo@qfmanju.ai'`).get();
  const rich = db.prepare(
    `SELECT p.id, COUNT(a.id) c FROM projects p LEFT JOIN project_assets a ON a.project_id=p.id
     WHERE p.user_id=? GROUP BY p.id ORDER BY c DESC LIMIT 1`,
  ).get(demo.id);
  const withNarr = db.prepare(
    `SELECT DISTINCT p.id FROM projects p JOIN project_assets a ON a.project_id=p.id
     WHERE p.user_id=? AND a.type='narration' LIMIT 1`,
  ).get(demo.id);
  db.close();
  return { rich: rich?.id, narr: withNarr?.id || rich?.id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, text) {
  return page.evaluate((t) => {
    // 只点真正可点的控件 (button/a/[role=tab]), 否则会误点包含该文字的外层 div (no-op)
    const els = [...document.querySelectorAll('button,a,[role="tab"]')];
    // 优先精确匹配 (短标签), 再退回包含匹配
    let el = els.find((e) => (e.textContent || '').trim() === t && e.offsetParent !== null);
    if (!el) el = els.find((e) => (e.textContent || '').trim().includes(t) && e.offsetParent !== null);
    if (el) { el.click(); return true; }
    return false;
  }, text);
}

async function main() {
  const { rich, narr } = pickProjects();
  console.log('[v6] projects:', { rich, narr });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // login
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
  console.log('[v6] login:', login);

  const shot = async (name) => {
    const f = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log('[v6] shot', name, '→', f);
  };

  const scenes = [
    { name: 'dashboard', path: '/dashboard', wait: 2200 },
    { name: 'health', path: '/dashboard/health', wait: 3500 },
    { name: 'styles', path: '/dashboard/styles', wait: 2500 },
    { name: 'team', path: '/dashboard/team', wait: 2200 },
    { name: 'characters', path: '/dashboard/characters', wait: 2500 },
  ];
  for (const s of scenes) {
    await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
    await sleep(s.wait);
    await shot(s.name);
  }

  // story-intake: 注入样例长文 → 智能拆解 → 截分集预览
  await page.goto(`${BASE}/dashboard/story-intake`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(1200);
  const ta = await page.$('textarea');
  if (ta) {
    const sample = '第一章 雾起山门\n少年踏雪而来,晨雾未散,松涛阵阵。他握紧手中残破的家传剑谱,眼神坚定。山门巍峨,石阶千级,通向云深不知处。\n\n第二章 拜师\n老者立于古松之下,白须飘飘。"你为何习剑?"少年答:"为护我所爱之人。"老者颔首,递出一枚青玉令牌。\n\n第三章 初试锋芒\n演武场上,众弟子环伺。少年长剑出鞘,寒光乍现,一招"裂云"惊退三人,满场哗然。';
    await ta.click();
    await page.keyboard.type(sample, { delay: 4 });
    await sleep(400);
    await clickText(page, '智能拆解');
    await sleep(1800);
  }
  await shot('story-intake');

  // director console: 项目页 → 导演台 tab
  if (rich) {
    await page.goto(`${BASE}/projects/${rich}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
    await sleep(2500);
    await clickText(page, '导演台');
    await sleep(1800);
    await shot('director-console');
  }

  // timeline + narration 轨: 带 narration 的项目 → 时间线 tab
  if (narr) {
    await page.goto(`${BASE}/projects/${narr}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
    await sleep(2500);
    (await clickText(page, '时间线')) || (await clickText(page, 'Cinema')) || (await clickText(page, '时间轴'));
    await sleep(2500);
    await shot('cinema-timeline');
  }

  await browser.close();
  console.log('[v6] done. files in', outDir);
}
main().catch((e) => { console.error(e); process.exit(1); });
