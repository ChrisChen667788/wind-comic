import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.5.4 — 留存面验收:
 *   1. dashboard 渲染「继续创作」卡(demo 库有项目)
 *   2. 懒 digest:拉通知触发 → weekly_digest 入通知中心(验收条款)
 */

function mintSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db
    .prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'")
    .get() as any;
  db.close();
  const token = jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user, userId: u.id as string };
}

test('dashboard 渲染继续创作卡', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token, user } = mintSession();
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('qfmj-token', t as string);
      localStorage.setItem('qfmj-user', u as string);
    },
    [token, JSON.stringify(user)] as [string, string],
  );
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('continue-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('继续创作', { exact: false }).first()).toBeVisible();
});

test('懒 digest:拉通知 → weekly_digest 入通知中心', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token, userId } = mintSession();
  // 清掉旧周报,验证「本次拉取」真的会触发新一条
  const db = new Database('data/qfmj.db');
  db.prepare("DELETE FROM notifications WHERE recipient_user_id = ? AND type = 'weekly_digest'").run(userId);
  db.close();

  const res = await request.get('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);

  // fire-and-forget → 轮询落库
  await expect
    .poll(() => {
      const d = new Database('data/qfmj.db', { readonly: true });
      const r = d.prepare("SELECT count(*) c FROM notifications WHERE recipient_user_id = ? AND type = 'weekly_digest'").get(userId) as { c: number };
      d.close();
      return r.c;
    }, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 再拉一次:通知列表里能看到周报(入通知中心)且 7 天幂等不再加
  const res2 = await request.get('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
  const body = await res2.json();
  const digests = (body.notifications || []).filter((n: any) => n.type === 'weekly_digest');
  expect(digests.length).toBe(1);
  expect(digests[0].preview).toContain('周报');
});
