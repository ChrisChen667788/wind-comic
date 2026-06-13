import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * 全站 a11y / 对比度门禁(axe · WCAG 2 A/AA)—— 每页断言无 critical/serious 违规。
 * v10.3.2 起 --soft/--muted 已提亮达标;本 spec 把门禁从 landing 扩到公开页 + 登录态 dashboard 页。
 * 用 page.waitForTimeout(避开 SSE 导致 networkidle 永不触发),desktop + mobile 各跑。
 */
async function audit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600); // 等客户端渲染 + 数据;dashboard 有 SSE,不用 networkidle
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (blocking.length) {
    console.log(`a11y ${path}:`, blocking.map((v) => `${v.id}×${v.nodes.length}`).join(', '));
  }
  expect(blocking.map((v) => v.id), `${path} 不应有 critical/serious a11y 违规`).toEqual([]);
}

// ── 公开页(无需登录)──
for (const path of ['/', '/pricing', '/cases', '/auth']) {
  test(`a11y public ${path}`, async ({ page }) => {
    await audit(page, path);
  });
}

// ── 登录态 dashboard 页(注入 demo 会话 token,与应用 signToken 同密钥)──
function mintDemoSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db
    .prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'")
    .get() as { id: string; email: string; name: string; role: string; avatar_url: string; locale: string };
  db.close();
  const secret = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
  const token = jwt.sign({ sub: u.id, role: u.role }, secret, { expiresIn: '7d' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user };
}

test.describe('a11y dashboard (authed)', () => {
  const { token, user } = mintDemoSession();
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([t, u]) => {
        localStorage.setItem('qfmj-token', t as string);
        localStorage.setItem('qfmj-user', u as string);
        localStorage.setItem('qfmj-create-guide-done', '1'); // v10.5.3: 预置引导完成,防遮罩挡操作/污染 axe 基线
      },
      [token, JSON.stringify(user)] as [string, string],
    );
  });

  for (const path of ['/dashboard', '/dashboard/create', '/dashboard/templates', '/dashboard/billing', '/dashboard/jobs']) {
    test(`a11y authed ${path}`, async ({ page }) => {
      await audit(page, path);
    });
  }
});
