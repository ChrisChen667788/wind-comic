#!/usr/bin/env node
/**
 * v3.1.3 — Scenario screenshots (popovers + collab dual-window).
 *
 * 不同于 capture-screenshots.mjs (单页静态 capture), 这个脚本拍"交互发生时"
 * 的截图: 弹 popover, 双用户协作光标, 通知 dropdown 等.
 *
 * 用法: node scripts/capture-scenes.mjs
 *
 * 前置:
 *   - dev server :3000 (npm run dev)
 *   - WS server :1234 (npm run dev:ws) — 协作场景需要
 *   - Seed: demo@qfmanju.ai + 一个测试 alice@test.local 用户 (脚本自动创建)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'assets');
const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:3000';

const SYSTEM_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

// ─── 准备测试 alice 用户 (用于协作场景) ───────────────────────────────────────
function ensureAliceUser() {
  const db = new Database(path.join(projectRoot, 'data', 'qfmj.db'));
  const aliceId = 'alice-collab-test';
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(aliceId);
  if (!existing) {
    const passwordHash = bcrypt.hashSync('AlicePass123', 8);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
       VALUES (?, ?, ?, 'Alice 协作者', 'user', 'zh', ?)`,
    ).run(aliceId, 'alice@test.local', passwordHash, new Date().toISOString());
    console.log('[scenes] created test user alice@test.local');
  }
  db.close();
  return { id: aliceId, email: 'alice@test.local', password: 'AlicePass123' };
}

// ─── 找 demo 用户 + 项目 ─────────────────────────────────────────────────────
function getFixtures() {
  const db = new Database(path.join(projectRoot, 'data', 'qfmj.db'), { readonly: true });
  const demo = db.prepare(`SELECT id, email FROM users WHERE email = 'demo@qfmanju.ai'`).get();
  const project = db.prepare(
    `SELECT id FROM projects WHERE user_id = ? AND id NOT LIKE 'test%' ORDER BY created_at DESC LIMIT 1`,
  ).get(demo?.id);
  db.close();
  return { demo, projectId: project?.id };
}

async function loginViaLocalStorage(page, email, password) {
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(async (email, password) => {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) return { ok: false, status: resp.status };
    const data = await resp.json();
    localStorage.setItem('qfmj-token', data.token);
    localStorage.setItem('qfmj-user', JSON.stringify(data.user));
    return { ok: true, user: data.user };
  }, email, password);
  return r;
}

async function clickByText(page, text, { tag = 'button' } = {}) {
  return await page.evaluate(({ text, tag }) => {
    const nodes = Array.from(document.querySelectorAll(`${tag}, a, [role="tab"], [role="button"]`));
    const match = nodes.find((n) => (n.textContent || '').includes(text));
    if (match) {
      match.scrollIntoView({ block: 'center' });
      match.click();
      return true;
    }
    return false;
  }, { text, tag });
}

async function shoot(page, name) {
  const outFile = path.join(assetsDir, `screenshot-${name}-v3.1.3.png`);
  await page.screenshot({ path: outFile, fullPage: false });
  const stat = fs.statSync(outFile);
  console.log(`[scenes] → ${outFile} (${(stat.size / 1024).toFixed(0)} KB)`);
}

(async () => {
  const alice = ensureAliceUser();
  const { demo, projectId } = getFixtures();
  if (!demo || !projectId) {
    console.error('[scenes] need a seeded demo user + at least 1 real project');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: SYSTEM_CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  // ─── Scene 1: Owner with invite popover open ─────────────────────────────
  {
    console.log('\n[scenes] === invite popover ===');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await loginViaLocalStorage(page, demo.email, 'Qfmanju123');
    await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3500));
    // Radix Popover trigger 可能不带 title 属性 — 用 UserPlus icon SVG 路径作 selector
    const opened = await page.evaluate(() => {
      // Try several strategies
      const strategies = [
        () => Array.from(document.querySelectorAll('button')).find((b) =>
          (b.getAttribute('title') || '').includes('邀请协作者')),
        () => Array.from(document.querySelectorAll('button')).find((b) =>
          (b.getAttribute('title') || '').includes('协作者')),
        // UserPlus icon's path d attribute is unique enough — lucide draws it as path with specific d
        () => {
          const svgs = Array.from(document.querySelectorAll('svg.lucide-user-plus'));
          if (svgs[0]) {
            // climb to nearest button
            let n = svgs[0].closest('button, [role="button"]');
            return n || null;
          }
          return null;
        },
        // Fallback: nav-bar last button cluster
        () => {
          const navBtns = Array.from(document.querySelectorAll('nav button, header button'));
          return navBtns.find((b) => b.querySelector('svg.lucide-user-plus'));
        },
      ];
      for (const strat of strategies) {
        const m = strat();
        if (m) {
          m.scrollIntoView({ block: 'center' });
          m.click();
          return { ok: true, html: m.outerHTML.slice(0, 200) };
        }
      }
      // Debug: dump all button titles
      const allTitles = Array.from(document.querySelectorAll('button')).map((b) => b.title || '').filter(Boolean).slice(0, 20);
      return { ok: false, debug: allTitles };
    });
    if (opened.ok) {
      console.log('[scenes]   clicked invite trigger:', opened.html);
      await new Promise((r) => setTimeout(r, 1500));
      await shoot(page, 'invite-popover');
    } else {
      console.warn('[scenes]   invite button not found. Debug titles:', opened.debug);
    }
    await page.close();
  }

  // ─── Scene 2: Notification bell dropdown ─────────────────────────────────
  {
    console.log('\n[scenes] === notification bell ===');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await loginViaLocalStorage(page, demo.email, 'Qfmanju123');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2000));
    // The bell is in dashboard layout absolute top-4 right-5 — title="通知"
    const opened = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
      const match = candidates.find((b) => (b.getAttribute('title') || '').startsWith('通知'));
      if (match) {
        match.scrollIntoView({ block: 'center' });
        match.click();
        return true;
      }
      return false;
    });
    if (opened) {
      await new Promise((r) => setTimeout(r, 1500));
      await shoot(page, 'notifications-dropdown');
    } else {
      console.warn('[scenes]   notification bell not found');
    }
    await page.close();
  }

  // ─── Scene 3: Storyboard regen modal open ────────────────────────────────
  {
    console.log('\n[scenes] === storyboard regen modal ===');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await loginViaLocalStorage(page, demo.email, 'Qfmanju123');
    await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));
    // Switch to workshop tab
    await clickByText(page, '镜头工坊');
    await new Promise((r) => setTimeout(r, 1500));
    const opened = await clickByText(page, '改 prompt 重生');
    if (opened) {
      await new Promise((r) => setTimeout(r, 1500));
      await shoot(page, 'storyboard-regen-modal');
    } else {
      console.warn('[scenes]   "改 prompt 重生" button not found');
    }
    await page.close();
  }

  // ─── Scene 4: Cinema Timeline with alice's remote cursor visible ─────────
  {
    console.log('\n[scenes] === cinema timeline with collab cursor ===');
    // Owner page
    const ownerPage = await browser.newPage();
    await ownerPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await loginViaLocalStorage(ownerPage, demo.email, 'Qfmanju123');
    await ownerPage.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));
    await clickByText(ownerPage, 'Cinema 时间线');
    await new Promise((r) => setTimeout(r, 2500));

    // Alice page - 必须先把 alice 加为 collaborator 才能看到 project. 用 owner page 上下文里
    // 创建邀请并接受, 是最便携的: 让 alice 用 owner 创建的 token 自动 accept.
    // 简化: 直接用 lib/project-share 路径插入 collaborators row.
    const db = new Database(path.join(projectRoot, 'data', 'qfmj.db'));
    const existingCollab = db.prepare(
      `SELECT id FROM project_collaborators WHERE project_id = ? AND user_id = ?`,
    ).get(projectId, alice.id);
    if (!existingCollab) {
      db.prepare(`
        INSERT INTO project_collaborators
          (id, project_id, user_id, role, invited_by_user_id, joined_at)
        VALUES (?, ?, ?, 'editor', ?, ?)
      `).run('demo-alice-collab', projectId, alice.id, demo.id, new Date().toISOString());
      console.log('[scenes]   added alice as editor collaborator');
    }
    db.close();

    const alicePage = await browser.newPage();
    await alicePage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await loginViaLocalStorage(alicePage, alice.email, alice.password);
    await alicePage.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    await clickByText(alicePage, 'Cinema 时间线');
    await new Promise((r) => setTimeout(r, 2500));

    // Alice 在 timeline 上 hover (mousemove) — 这会 publish 她的 cursor 到 Yjs awareness
    const aliceCursorPx = await alicePage.evaluate(() => {
      const tracks = document.querySelector('.cinema-card-hi + .relative.space-y-3, .relative.space-y-3');
      if (!tracks) return null;
      const rect = tracks.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width * 0.45), y: Math.round(rect.top + rect.height * 0.4) };
    });
    if (aliceCursorPx) {
      await alicePage.mouse.move(aliceCursorPx.x, aliceCursorPx.y);
      await alicePage.mouse.move(aliceCursorPx.x + 50, aliceCursorPx.y + 5); // 微动让 awareness 触发
      console.log(`[scenes]   alice cursor at ${aliceCursorPx.x},${aliceCursorPx.y}`);
    }

    // 等 Yjs awareness 传到 owner page (≥50ms throttle + WS roundtrip)
    await new Promise((r) => setTimeout(r, 2000));

    // 回到 owner page screenshot - 应该能看到 alice 的颜色光标 + 标签
    await ownerPage.bringToFront();
    await new Promise((r) => setTimeout(r, 500));
    await shoot(ownerPage, 'cinema-timeline-collab');

    await ownerPage.close();
    await alicePage.close();
  }

  await browser.close();
  console.log('\n[scenes] done. 4 scene shots in assets/');
})();
