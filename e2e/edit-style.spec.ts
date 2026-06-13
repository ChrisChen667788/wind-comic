import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v12.0.4 — 一句指令调剪辑风格(BYO)UI 验收:
 * 创作工坊(pro)出现剪辑风格 picker;预设 chip 点击回填输入框;自由文本可编辑。
 * 纯 UI 断言(不跑流水线),走 desktop。
 */
function mintDemoSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  const secret = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
  const token = jwt.sign({ sub: u.id, role: u.role }, secret, { expiresIn: '1h' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user };
}

test('剪辑风格 picker:预设 chip 回填 + 自由文本', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token, user } = mintDemoSession();
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('qfmj-token', t as string);
    localStorage.setItem('qfmj-user', u as string);
    localStorage.setItem('qfmj-create-guide-done', '1');
  }, [token, JSON.stringify(user)] as [string, string]);
  await page.goto('/dashboard/create', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const picker = page.locator('[data-testid="edit-style-picker"]');
  await expect(picker).toBeVisible();

  // 点「快节奏燃向」chip → 输入框回填该指令
  await picker.getByRole('button', { name: /快节奏燃向/ }).click();
  await expect(picker.locator('input[type="text"]')).toHaveValue('快节奏燃向');

  // 「默认中速」→ 清空
  await picker.getByRole('button', { name: '默认中速' }).click();
  await expect(picker.locator('input[type="text"]')).toHaveValue('');

  // 自由文本可编辑
  await picker.locator('input[type="text"]').fill('抖音爆款卡点');
  await expect(picker.locator('input[type="text"]')).toHaveValue('抖音爆款卡点');
});
