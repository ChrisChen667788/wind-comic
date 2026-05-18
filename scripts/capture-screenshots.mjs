#!/usr/bin/env node
/**
 * v3.1.3 — Real screenshot capture for assets/screenshot-*.png.
 *
 * 用法:
 *   node scripts/capture-screenshots.mjs            # 默认 capture 全套
 *   CAPTURE_ONLY=cinema-timeline node ...           # 只 capture 某一张
 *   PROJECT_ID=<id> node ...                        # 用指定项目演示项目页 (默认查 demo 用户最新)
 *
 * 前置:
 *   1. dev server 在 :3000 (`npm run dev`)
 *   2. data/qfmj.db 里有 seed demo user + 至少 1 个项目
 *   3. (可选) `npm run dev:ws` 启动后可拍协作场景
 *
 * 不需要 OPENAI 等 API key — capture 静态 UI 不触发后端 LLM 调用
 *
 * 输出: assets/screenshot-<module>-v3.1.3.png
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'assets');

const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:3000';
const ONLY = process.env.CAPTURE_ONLY || '';
const HEADLESS = process.env.SCREENSHOT_HEADFUL ? false : 'new';

// Look up demo user + latest project for the per-project pages
function getDemoFixtures() {
  try {
    const dbPath = path.join(projectRoot, 'data', 'qfmj.db');
    if (!fs.existsSync(dbPath)) return { userId: null, projectId: null };
    const db = new Database(dbPath, { readonly: true });
    const user = db.prepare(`SELECT id, email FROM users WHERE email = 'demo@qfmanju.ai' LIMIT 1`).get();
    if (!user) {
      db.close();
      return { userId: null, projectId: null };
    }
    const project = process.env.PROJECT_ID
      ? db.prepare(`SELECT id FROM projects WHERE id = ?`).get(process.env.PROJECT_ID)
      : db.prepare(
          `SELECT id FROM projects WHERE user_id = ? AND id NOT LIKE 'test_proj_%' AND id NOT LIKE 'test-%' ORDER BY created_at DESC LIMIT 1`,
        ).get(user.id);
    db.close();
    return {
      userId: user.id,
      email: user.email,
      projectId: project?.id || null,
    };
  } catch (e) {
    console.warn('[capture] db lookup failed:', e.message);
    return { userId: null, projectId: null };
  }
}

const fixtures = getDemoFixtures();
console.log(`[capture] demo user: ${fixtures.email || '(none)'}, project: ${fixtures.projectId || '(none)'}`);

if (!fixtures.email) {
  console.error('[capture] FATAL: no demo user. Run npm run dev once to seed the db.');
  process.exit(1);
}

// ─── Routes & elements to capture ───────────────────────────────────────────
const TASKS = [
  {
    name: 'home',
    path: '/',
    auth: false,
    wait: 1500,
  },
  {
    name: 'dashboard',
    path: '/dashboard',
    auth: true,
    wait: 2000,
  },
  {
    name: 'create',
    path: '/dashboard/create',
    auth: true,
    wait: 2500,
  },
  {
    name: 'projects',
    path: '/dashboard/projects',
    auth: true,
    wait: 2000,
  },
  {
    name: 'assets',
    path: '/dashboard/assets',
    auth: true,
    wait: 4500,
    lazyImages: true,
  },
  // Per-project — needs a project id
  ...(fixtures.projectId ? [
    {
      name: 'storyboard',
      path: `/projects/${fixtures.projectId}`,
      auth: true,
      wait: 3000,
      preClick: 'button:has-text("分镜"), [data-tab="storyboard"]',
    },
    {
      name: 'cinema-timeline',
      path: `/projects/${fixtures.projectId}`,
      auth: true,
      wait: 3000,
      // try various selectors for the timeline tab; whichever clicks first wins
      tabKey: 'timeline',
    },
    {
      name: 'pacing',
      path: `/projects/${fixtures.projectId}`,
      auth: true,
      wait: 2500,
      tabKey: 'pacing',
    },
    {
      name: 'comments',
      path: `/projects/${fixtures.projectId}`,
      auth: true,
      wait: 2500,
      tabKey: 'comments',
    },
    {
      name: 'workshop',
      path: `/projects/${fixtures.projectId}`,
      auth: true,
      wait: 2500,
      tabKey: 'workshop',
    },
  ] : []),
];

async function loginIfNeeded(page) {
  // 直接调 /api/auth/login 拿 token, 然后 inject 到 localStorage —
  // 比 UI 表单填+点+等导航靠谱得多 (puppeteer 默认 click 在 React form 上偶尔不触发 submit)
  console.log('[capture] logging in as demo user (via API + localStorage inject)...');
  // 先访问一个本站 URL 让 localStorage 域名对上
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const loginResp = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@qfmanju.ai', password: 'Qfmanju123' }),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const data = await r.json();
    localStorage.setItem('qfmj-token', data.token);
    localStorage.setItem('qfmj-user', JSON.stringify(data.user));
    return { ok: true, userId: data.user?.id, name: data.user?.name };
  });
  console.log('[capture] login result:', loginResp);
}

async function clickTab(page, tabKey) {
  // Project page has tabs with data-tab attribute OR text content
  return await page.evaluate((key) => {
    const btns = Array.from(document.querySelectorAll('button, a, [role="tab"]'));
    // First try data-tab attribute (if any)
    let target = btns.find((b) => b.dataset?.tab === key);
    if (!target) {
      const TAB_TEXT = {
        timeline: '时间线',
        pacing: '节奏分析',
        comments: '评论协作',
        workshop: '镜头工坊',
        storyboard: '分镜',
      };
      const wantText = TAB_TEXT[key];
      if (wantText) {
        target = btns.find((b) => (b.textContent || '').includes(wantText));
      }
    }
    if (target) {
      target.click();
      return true;
    }
    return false;
  }, tabKey);
}

(async () => {
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  // Prefer system Chrome if available (faster than waiting for puppeteer's bundled Chromium)
  const systemChromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const systemChrome = systemChromePaths.find((p) => fs.existsSync(p));
  if (systemChrome) console.log(`[capture] using system browser: ${systemChrome}`);

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    executablePath: systemChrome || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // Login once, cookie persists across page.goto
  await loginIfNeeded(page);

  for (const task of TASKS) {
    if (ONLY && task.name !== ONLY) continue;
    const target = `${BASE}${task.path}`;
    console.log(`[capture] ${task.name} ← ${target}`);
    try {
      // 大多数页用 networkidle2; assets/projects 因为加载很多缩略图永远不 idle,
      // 走 domcontentloaded + 长一点的 sleep 兜底.
      const waitUntil = task.lazyImages ? 'domcontentloaded' : 'networkidle2';
      const timeout = task.lazyImages ? 15000 : 45000;
      await page.goto(target, { waitUntil, timeout });
      await new Promise((r) => setTimeout(r, task.wait || 1500));
      if (task.tabKey) {
        const ok = await clickTab(page, task.tabKey);
        if (ok) {
          await new Promise((r) => setTimeout(r, 1500));
        } else {
          console.warn(`[capture]   tab "${task.tabKey}" not found — capturing default landing instead`);
        }
      }
      const outFile = path.join(assetsDir, `screenshot-${task.name}-v3.1.3.png`);
      await page.screenshot({ path: outFile, fullPage: false });
      const stat = fs.statSync(outFile);
      console.log(`[capture]   → ${outFile} (${(stat.size / 1024).toFixed(0)} KB)`);
      // Also overwrite the legacy filename if exists, so old README refs still work
      const legacyName = path.join(assetsDir, `screenshot-${task.name}.png`);
      try { fs.copyFileSync(outFile, legacyName); } catch { /* ignore */ }
    } catch (e) {
      console.error(`[capture] ${task.name} FAILED:`, e.message);
    }
  }

  await browser.close();
  console.log('[capture] done.');
})();
