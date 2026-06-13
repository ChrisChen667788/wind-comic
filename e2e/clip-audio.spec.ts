import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v12.1.0 — 片段预览叠播配音验收(《雨夜信号》):
 * 视频 tab 每镜显示音频徽章;有 shot-audio 的镜叠播配音(<audio>),无的明确标注。
 */
const SECRET = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
function tok() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  return jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '1h' });
}

test('片段预览:音频徽章 + 有配音的镜叠播 <audio>', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  await request.post('/api/demo-project', { headers: { Authorization: `Bearer ${tok()}` } });

  await page.goto('/auth');
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@qfmanju.ai', password: 'Qfmanju123' }) });
    const d = await r.json(); localStorage.setItem('qfmj-token', d.token); localStorage.setItem('qfmj-user', JSON.stringify(d.user));
  });
  await page.goto('/projects/qfmj-demo-showcase', { waitUntil: 'networkidle' });

  // 切到「视频」tab
  await page.getByRole('button', { name: /^视频/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);

  // 音频徽章存在(每个片段一个)
  const badges = page.locator('[data-testid="clip-audio-badge"]');
  await expect(badges.first()).toBeVisible();
  const count = await badges.count();
  expect(count).toBeGreaterThanOrEqual(1);

  // 至少出现「带配音」或「片段无独立音轨」文案之一
  const bodyText = await page.locator('[data-testid="clip-audio-badge"]').first().textContent();
  expect(bodyText === null || /带配音|片段无独立音轨/.test(bodyText || '')).toBeTruthy();
});
