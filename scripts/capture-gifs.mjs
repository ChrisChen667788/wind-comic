#!/usr/bin/env node
/**
 * v3.1.3 — Marketing GIF generator.
 *
 * 思路:
 *   - puppeteer 每隔 N ms 截 1 张, 攒 K 帧
 *   - ffmpeg-static 把帧合成 gif (palette-genned 大小约 800KB-2MB)
 *
 * 用法:
 *   node scripts/capture-gifs.mjs                # 全部
 *   GIF_ONLY=pipeline-flow node ...              # 单个
 *
 * 输出: assets/<name>.gif
 *
 * 已实现 GIF:
 *   1. pipeline-flow — 创作总览 + 创作工坊 + 我的项目 + 分镜 4 步轮播 (静态切换)
 *   2. cinema-timeline-snap — 在 timeline 上拖一段触发 snap 闪光 (10s, 真交互)
 *   3. pacing-bars-reveal — 节奏分析页, 柱状图加载动画 + 滚动到 warnings (5s)
 *   4. workshop-regen-modal — 镜头工坊 → "改 prompt 重生" modal 打开演示
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'assets');
const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:3000';
const ONLY = process.env.GIF_ONLY || '';

const SYSTEM_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

const FFMPEG = path.join(projectRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');

function getFixtures() {
  const db = new Database(path.join(projectRoot, 'data', 'qfmj.db'), { readonly: true });
  const demo = db.prepare(`SELECT id, email FROM users WHERE email = 'demo@qfmanju.ai'`).get();
  const project = db.prepare(
    `SELECT id FROM projects WHERE user_id = ? AND id NOT LIKE 'test%' ORDER BY created_at DESC LIMIT 1`,
  ).get(demo?.id);
  db.close();
  return { demo, projectId: project?.id };
}

async function login(page, email = 'demo@qfmanju.ai', password = 'Qfmanju123') {
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) {
      const data = await r.json();
      localStorage.setItem('qfmj-token', data.token);
      localStorage.setItem('qfmj-user', JSON.stringify(data.user));
    }
  }, { email, password });
}

async function clickByText(page, text) {
  return await page.evaluate((text) => {
    const nodes = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"]'));
    const m = nodes.find((n) => (n.textContent || '').includes(text));
    if (m) { m.scrollIntoView({ block: 'center' }); m.click(); return true; }
    return false;
  }, text);
}

/**
 * 攒帧 → ffmpeg 合成 GIF.
 * frames: Array<{ buffer: Buffer, durationMs: number }>
 *   durationMs 是该帧应该停留多久 (用于变速 gif).
 */
async function framesToGif(frames, outFile, opts = {}) {
  // v3.2 P3.3: 输入校验. 规则同 lib/gif-pipeline.ts validateFrames (有 vitest 覆盖).
  // 这段重复是因为脚本是 .mjs, .ts 在脚本运行时不能直接 import — 真要去重需要先 tsc 编译.
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('framesToGif: empty or non-array frames');
  }
  if (frames.length > 10_000) {
    throw new Error(`framesToGif: too many frames (${frames.length}) — runaway capture loop?`);
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f || !f.buffer || f.buffer.length === 0) {
      throw new Error(`framesToGif: frame[${i}] missing/empty buffer`);
    }
  }
  const { fps = 10, width = 960 } = opts;
  const tmpDir = path.join('/tmp', `qf-gif-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  // 写所有 frame
  const frameFiles = [];
  for (let i = 0; i < frames.length; i++) {
    const fp = path.join(tmpDir, `frame-${String(i).padStart(4, '0')}.png`);
    fs.writeFileSync(fp, frames[i].buffer);
    frameFiles.push({ path: fp, durationMs: frames[i].durationMs || (1000 / fps) });
  }
  // 用 concat demuxer 控帧时长
  const listFile = path.join(tmpDir, 'list.txt');
  const listContent = frameFiles.map((f) =>
    `file '${f.path}'\nduration ${(f.durationMs / 1000).toFixed(3)}`
  ).join('\n') + `\nfile '${frameFiles[frameFiles.length - 1].path}'\n`;
  fs.writeFileSync(listFile, listContent);

  // palette + paletteuse for high-quality gif
  const palettePath = path.join(tmpDir, 'palette.png');
  await runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=full`,
    palettePath,
  ]);
  await runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-i', palettePath,
    '-filter_complex', `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5`,
    '-loop', '0',
    outFile,
  ]);
  // cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`));
    });
  });
}

/**
 * 一个轻量 capture cycle: 反复 page.screenshot 攒帧.
 */
async function captureCycle(page, durationMs, intervalMs = 100) {
  const frames = [];
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const buf = await page.screenshot({ type: 'png', encoding: 'binary' });
    frames.push({ buffer: buf, durationMs: intervalMs });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return frames;
}

// ─── GIF Recipes ────────────────────────────────────────────────────────────

async function gif_pipelineFlow(browser, fixtures) {
  // 切换 4 个页, 每张定格 1.2s, 中间 fade-in (无, 直接切)
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 800, deviceScaleFactor: 1 });
  await login(page);

  const stops = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/dashboard/create', label: 'Creation' },
    { path: '/dashboard/projects', label: 'Projects' },
    { path: `/projects/${fixtures.projectId}`, label: 'Storyboard' },
  ];
  const frames = [];
  for (const s of stops) {
    try {
      const waitUntil = s.path.includes('/projects/') ? 'domcontentloaded' : 'networkidle2';
      await page.goto(`${BASE}${s.path}`, { waitUntil, timeout: 30000 });
    } catch (e) {
      console.warn(`[gif] pipeline-flow: ${s.label} navigation slow, screenshotting anyway`);
    }
    await new Promise((r) => setTimeout(r, 2500));
    const buf = await page.screenshot({ type: 'png', encoding: 'binary' });
    frames.push({ buffer: buf, durationMs: 1500 });
  }
  await page.close();
  return frames;
}

async function gif_paclingBarsReveal(browser, fixtures) {
  // 节奏 tab, 滚动 + capture
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 800, deviceScaleFactor: 1 });
  await login(page);
  await page.goto(`${BASE}/projects/${fixtures.projectId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await clickByText(page, '节奏分析');
  await new Promise((r) => setTimeout(r, 2000));
  // 慢慢滚 → 帧拍下来. 步数减半防 CDP timeout, 大点的滚距弥补
  const frames = [];
  const scrollSteps = 12;
  for (let i = 0; i < scrollSteps; i++) {
    await page.evaluate((step) => window.scrollBy(0, step), 38);
    const buf = await page.screenshot({ type: 'png', encoding: 'binary' });
    frames.push({ buffer: buf, durationMs: 200 });
  }
  // 末尾停留 1.5s
  if (frames.length > 0) frames[frames.length - 1].durationMs = 1500;
  await page.close();
  return frames;
}

async function gif_workshopRegenModal(browser, fixtures) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 800, deviceScaleFactor: 1 });
  await login(page);
  await page.goto(`${BASE}/projects/${fixtures.projectId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  // 切到 workshop tab
  await clickByText(page, '镜头工坊');
  await new Promise((r) => setTimeout(r, 1500));
  // 拍 1 帧 workshop list (3s)
  const beforeShot = await page.screenshot({ type: 'png', encoding: 'binary' });
  const frames = [{ buffer: beforeShot, durationMs: 2500 }];
  // 点 "改 prompt 重生"
  await clickByText(page, '改 prompt 重生');
  await new Promise((r) => setTimeout(r, 1200));
  // 拍 modal 打开 (3s)
  const modalShot = await page.screenshot({ type: 'png', encoding: 'binary' });
  frames.push({ buffer: modalShot, durationMs: 3000 });
  await page.close();
  return frames;
}

async function gif_cinemaTimelineSnap(browser, fixtures) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 800, deviceScaleFactor: 1 });
  await login(page);
  await page.goto(`${BASE}/projects/${fixtures.projectId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await clickByText(page, 'Cinema 时间线');
  await new Promise((r) => setTimeout(r, 2500));

  // 找一个 BGM 段并模拟拖动 → snap
  const segCoords = await page.evaluate(() => {
    // BGM track row 在 SHOTS 之下. 找有 .ew-resize cursor 的段
    const allDivs = Array.from(document.querySelectorAll('div'));
    // 段是 absolute top-1 bottom-1 rounded border, 在 .relative.h-14 容器里
    const tracks = allDivs.find((d) => d.className?.includes?.('relative h-14'));
    if (!tracks) return null;
    const seg = tracks.querySelector('div[style*="cursor"]');
    if (!seg) return null;
    const r = seg.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), trackR: tracks.getBoundingClientRect() };
  });

  const frames = [];
  // 帧 1: 静态
  const buf0 = await page.screenshot({ type: 'png', encoding: 'binary' });
  frames.push({ buffer: buf0, durationMs: 1000 });

  if (segCoords) {
    // 慢慢拖动一段距离, 每 80ms 拍 1 帧
    await page.mouse.move(segCoords.x, segCoords.y);
    await page.mouse.down();
    const steps = 18;
    for (let i = 0; i < steps; i++) {
      await page.mouse.move(segCoords.x + (i + 1) * 12, segCoords.y, { steps: 2 });
      await new Promise((r) => setTimeout(r, 80));
      const buf = await page.screenshot({ type: 'png', encoding: 'binary' });
      frames.push({ buffer: buf, durationMs: 100 });
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 200));
    const lastBuf = await page.screenshot({ type: 'png', encoding: 'binary' });
    frames.push({ buffer: lastBuf, durationMs: 1500 });
  } else {
    console.warn('[gif] cinema-timeline-snap: BGM segment not found, using static frame');
    frames[0].durationMs = 3000;
  }

  await page.close();
  return frames;
}

const RECIPES = {
  'pipeline-flow': { fn: gif_pipelineFlow, fps: 6, width: 900 },
  'pacing-reveal': { fn: gif_paclingBarsReveal, fps: 10, width: 900 },
  'workshop-regen-modal': { fn: gif_workshopRegenModal, fps: 6, width: 900 },
  'cinema-timeline-snap': { fn: gif_cinemaTimelineSnap, fps: 10, width: 900 },
};

(async () => {
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  if (!fs.existsSync(FFMPEG)) {
    console.error('[gif] ffmpeg-static binary missing — npm install first');
    process.exit(1);
  }
  const fixtures = getFixtures();
  if (!fixtures.demo || !fixtures.projectId) {
    console.error('[gif] need seeded demo user + real project');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: SYSTEM_CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 180_000, // 重 dashboard + 多次连续 screenshot 会超 30s CDP default
  });

  for (const [name, recipe] of Object.entries(RECIPES)) {
    if (ONLY && name !== ONLY) continue;
    console.log(`\n[gif] === ${name} ===`);
    try {
      const frames = await recipe.fn(browser, fixtures);
      console.log(`[gif] ${name}: ${frames.length} frames captured`);
      const outFile = path.join(assetsDir, `${name}.gif`);
      await framesToGif(frames, outFile, { fps: recipe.fps, width: recipe.width });
      const stat = fs.statSync(outFile);
      console.log(`[gif] → ${outFile} (${(stat.size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.error(`[gif] ${name} FAILED:`, e.message);
    }
  }

  await browser.close();
  console.log('\n[gif] done.');
})();
