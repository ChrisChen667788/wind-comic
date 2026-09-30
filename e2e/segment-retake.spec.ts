import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * v12.459 — 片段重拍在**真浏览器**里走完(MOCK_ENGINES=1,零成本):
 *   单镜检查器 → 逐帧检视 → 框两帧 → 换算区间 → 预演 → 确认重拍 → take 出现(占位补丁)→ 采用 → 回退到原片。
 * 每一步都回库核对:take 指向缝合产物、采用后活动版 persistent_url 换了、回退后换回原片。
 *
 * 用一个**一次性项目**(归属 demo 账号),测完连同文件一并删除,不碰任何已有项目。
 * 服务器要求:MOCK_ENGINES=1(v12.459 起单镜重生在该模式下全封闭,补丁是本地假片、零外部调用),
 * 且 JWT_SECRET 与本文件一致(serve-file 签名也用它)。
 */
const SECRET = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
const sign = (abs: string) => `/api/serve-file?path=${encodeURIComponent(abs)}&sig=${crypto.createHmac('sha256', process.env.SERVE_FILE_SECRET || SECRET).update(abs).digest('hex').slice(0, 32)}`;
const FF = path.resolve('node_modules/ffmpeg-static/ffmpeg');

test('片段重拍:逐帧框选 → 预演 → 确认重拍 → 采用 → 回退', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  test.setTimeout(300_000);

  const pid = `e2e-segretake-${Date.now()}`;
  const dir = path.resolve('data/media/e2e-segretake', pid);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'src.mp4');
  const still = path.join(dir, 'shot1.jpg');
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-ar', '48000', src]);
  execFileSync(FF, ['-v', 'error', '-y', '-i', src, '-frames:v', '1', still]);

  const db = new Database('data/qfmj.db');
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  const token = jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '1h' });
  const ts = new Date().toISOString();
  const srcUrl = sign(src);
  db.prepare(`INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'completed', ?, ?)`)
    .run(pid, u.id, 'e2e 片段重拍', ts, ts);
  const put = (type: string, name: string, data: unknown, media: string[] = [], shot: number | null = null, persistent: string | null = null) =>
    db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(`${pid}-${type}-${shot ?? 0}`, pid, type, name, JSON.stringify(data), JSON.stringify(media), persistent, shot, ts, ts);
  put('timeline', '剪辑时间线', { timeline: [{ shotNumber: 1, duration: 8 }] });
  put('project-format', '项目格式', { fps: 24 });
  put('storyboard', '镜头 1', { description: '雨夜街口,她回头' }, [sign(still)], 1);
  put('video', '视频 1', { duration: 8, status: 'completed' }, [srcUrl], 1, srcUrl);
  const active = () => db.prepare(`SELECT persistent_url, media_urls, data FROM project_assets WHERE project_id=? AND type='video' AND shot_number=1`).get(pid) as any;

  try {
    // 项目页的数据请求走 cookie,面板与逐帧检视走 Authorization —— 两样都给
    await page.addInitScript((t) => localStorage.setItem('qfmj-token', t), token);
    await page.context().addCookies([{ name: 'qfmj-session', value: token, url: process.env.E2E_BASE_URL || 'http://localhost:3000' }]);
    await page.goto(`/projects/${pid}`);

    // 分镜 tab → 分镜卡 → 单镜检查器 → 逐帧检视
    await page.getByRole('tab', { name: /分镜/ }).click({ timeout: 120_000 });
    // 分镜图上整块盖着一层遮罩「检查器」(悬停才显形,但一直接收点击)—— 真实用户点到的就是它
    await page.getByAltText('镜头 1').first().scrollIntoViewIfNeeded({ timeout: 60_000 });
    await page.getByText('检查器', { exact: true }).first().click();
    await page.getByRole('button', { name: /逐帧检视/ }).click();

    // 框两帧 → 服务端换算区间
    await expect(page.getByAltText('第 72 帧')).toBeVisible({ timeout: 120_000 });
    await page.getByAltText('第 72 帧').click();
    await page.getByAltText('第 96 帧').click();
    await page.getByText('换算重拍区间').click();
    // 帧条按 2 帧取 1 抽稀,第 96 帧代表 96–97 两帧 → 区间右端 98/24 = 4.083s(服务端换算,前端不算)
    await expect(page.getByText(/3\.000s → 4\.083s/)).toBeVisible({ timeout: 30_000 });

    // 预演 → 确认重拍
    await page.getByTestId('segment-retake-preview').click();
    await expect(page.getByTestId('segment-retake-plan')).toContainText('总长仍是 8.000s');
    await page.getByTestId('segment-retake-confirm').click();
    await expect(page.getByTestId('segment-retake-notice')).toContainText('时长不变', { timeout: 120_000 });
    await expect(page.getByTestId('segment-retake-take')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('01-take-ready.png') });

    const take = db.prepare(`SELECT id, media_urls, persistent_url, data FROM project_assets WHERE project_id=? AND type='shot-video-take'`).get(pid) as any;
    expect(take.persistent_url, 'take 指向缝合产物').toMatch(/seg-retakes/);
    expect(JSON.parse(take.data).measuredDurationS).toBeCloseTo(8, 1);

    // 采用 → 活动版 persistent_url 换成缝合产物,duration 保留;列表里出现「原片」
    await page.getByRole('button', { name: '采用此版本' }).click();
    await expect(page.getByTestId('segment-retake-notice')).toContainText('已采用');
    // 这个项目没出过成片 → 不许说「成片需要重新合成」
    await expect(page.getByTestId('segment-retake-notice')).toContainText('还没有成片');
    expect(active().persistent_url).toBe(take.persistent_url);
    expect(JSON.parse(active().data).duration).toBe(8);
    await expect(page.getByTestId('segment-retake-take')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('02-adopted.png') });

    // 回退到原片
    await page.getByRole('button', { name: '回退到原片' }).click();
    await expect(page.getByTestId('segment-retake-notice')).toContainText('已回退到原片');
    expect(active().persistent_url).toBe(srcUrl);
    await page.screenshot({ path: testInfo.outputPath('03-rolled-back.png') });
  } finally {
    const files = (db.prepare(`SELECT media_urls, persistent_url FROM project_assets WHERE project_id=? AND type='shot-video-take'`).all(pid) as any[])
      .flatMap((r) => [r.persistent_url, ...(JSON.parse(r.media_urls || '[]'))])
      .map((url: string) => { try { return new URL(url, 'http://x').searchParams.get('path'); } catch { return null; } })
      .filter((p): p is string => !!p && p.includes(`segtake-${pid}-`));
    for (const f of new Set(files)) fs.rmSync(f, { force: true });
    db.prepare('DELETE FROM project_assets WHERE project_id = ?').run(pid);
    db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
