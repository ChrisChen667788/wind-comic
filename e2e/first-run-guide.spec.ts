import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.5.3 — 首跑引导 + 简易/专业开关验收(真浏览器):
 *   1. 首跑出现三步引导 → 走完 → 落 localStorage → ROLL 按钮可达(遮罩已撤)
 *   2. 埋点落库(completed 计数 +1 —— 「首跑完成率可埋点」验收条款)
 *   3. 简易模式隐藏高级面板;专业模式 = 现状(模板库/锁脸/运镜可见);刷新后记忆
 */

function mintSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db
    .prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'")
    .get() as any;
  db.close();
  const token = jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user };
}

function countEvent(event: string): number {
  const db = new Database('data/qfmj.db', { readonly: true });
  const r = db.prepare('SELECT count(*) c FROM ui_events WHERE event = ?').get(event) as { c: number };
  db.close();
  return r.c;
}

test('首跑三步引导:出现 → 走完 → 埋点落库 → ROLL 可达', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收;移动渲染由 smoke 覆盖');
  const { token, user } = mintSession();
  const before = countEvent('create_guide_completed');

  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('qfmj-token', t as string);
      localStorage.setItem('qfmj-user', u as string);
      // 故意不设 qfmj-create-guide-done —— 模拟真首跑
    },
    [token, JSON.stringify(user)] as [string, string],
  );
  await page.goto('/dashboard/create', { waitUntil: 'domcontentloaded' });

  // 步 1 → 2 → 3 → 开拍
  await expect(page.getByText('① 写下你的创意')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('② 选一个画风')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('③ 开机 · ROLL')).toBeVisible();
  await page.getByRole('button', { name: '开拍 🎬' }).click();

  // 遮罩撤了:textarea 可交互(填字即证可达)
  await page.locator('textarea.cinema-textarea').first().fill('引导后可正常输入的创意文本,超过十个字');
  const done = await page.evaluate(() => localStorage.getItem('qfmj-create-guide-done'));
  expect(done).toBe('1');

  // 埋点落库(完成率分子 +1)
  await expect.poll(() => countEvent('create_guide_completed'), { timeout: 10_000 }).toBeGreaterThan(before);

  // 刷新不再弹
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await expect(page.getByText('① 写下你的创意')).toHaveCount(0);
});

test('简易/专业开关:简易隐藏高级面板,专业=现状,刷新记忆', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token, user } = mintSession();
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('qfmj-token', t as string);
      localStorage.setItem('qfmj-user', u as string);
      localStorage.setItem('qfmj-create-guide-done', '1');
    },
    [token, JSON.stringify(user)] as [string, string],
  );
  await page.goto('/dashboard/create', { waitUntil: 'domcontentloaded' });

  // 默认专业 = 现状:高级面板可见
  await expect(page.getByText('Drafts · 草稿对比')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Engine · 视频引擎')).toBeVisible();

  // 切简易:高级面板隐藏,主干(创意/画风/ROLL)保留
  await page.getByRole('button', { name: '简易' }).click();
  await expect(page.getByText('Drafts · 草稿对比')).toHaveCount(0);
  await expect(page.getByText('Engine · 视频引擎')).toHaveCount(0);
  await expect(page.locator('textarea.cinema-textarea')).toBeVisible();
  await expect(page.getByText('Look · 画风预设')).toBeVisible();
  await expect(page.getByRole('button', { name: /开机.*ROLL|待输入创意/ })).toBeVisible();

  // 刷新记忆
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.getByText('Drafts · 草稿对比')).toHaveCount(0);

  // 切回专业 = 复原
  await page.getByRole('button', { name: '专业' }).click();
  await expect(page.getByText('Drafts · 草稿对比')).toBeVisible();
});
