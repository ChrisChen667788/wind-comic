import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.5.0 — 演示工程验收:「全新库 0 key 可浏览完整成片工作台(分镜/审计/导出全真)」。
 * 导入 → 资产全套 → 项目工作台页渲染 → 导出端点即刻可用。会话 mint,不走密码。
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

test('演示工程:导入 → 工作台全真 → 导出可用', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '验收跑 desktop;渲染响应式由 smoke 覆盖');
  const { token, user } = mintSession();
  const auth = { Authorization: `Bearer ${token}` };

  // ── 1. 一键导入(幂等)──
  const imp = await request.post('/api/demo-project', { headers: auth });
  expect([200, 201]).toContain(imp.status());
  const { projectId } = await imp.json();
  expect(projectId).toBe('qfmj-demo-showcase');

  // ── 2. 资产全套(分镜带图、镜头带片、成片在位)──
  const assets = await (await request.get(`/api/projects/${projectId}/assets`, { headers: auth })).json();
  const byType = (t: string) => (assets as any[]).filter((a) => a.type === t);
  expect(byType('storyboard').length).toBe(4);
  expect(byType('video').length).toBe(4);
  expect(byType('final_video').length).toBe(1);
  expect(JSON.stringify(assets)).toContain('/cases/clip-a.mp4');

  // ── 3. 工作台页渲染(0 key 全真浏览)──
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('qfmj-token', t as string);
      localStorage.setItem('qfmj-user', u as string);
    },
    [token, JSON.stringify(user)] as [string, string],
  );
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await expect(page.locator('body')).toContainText(/雨夜信号/);

  // ── 4. 导出即刻可用(EDL 文本 + 平台导出端点响应)──
  const edl = await request.get(`/api/projects/${projectId}/export-edl`, { headers: auth });
  expect(edl.status()).toBe(200);
  expect((await edl.text()).length).toBeGreaterThan(50);
});
