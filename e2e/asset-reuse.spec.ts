import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v12.2.3 — 跨集复用验收(阶段二十一):
 * /api/global-assets/similar 路由契约 + 创作工坊「相似角色」推荐(向量缺则文本兜底)。
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

const IMG = 'http://localhost:3000/api/mock-assets/image/seed-reuse.svg';
const SEED_NAME = '星澜测试XZ9';   // 库里已有
const NEAR_NAME = '星澜测试XZ8';   // 用户新建(近似,非精确)→ 应触发相似推荐

test('相似角色:路由契约 + 创作工坊推荐 + 一键复用', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token, user } = mintDemoSession();
  const auth = { Authorization: `Bearer ${token}` };

  // 1) 种一个带头像的库角色
  const create = await request.post('/api/global-assets', {
    headers: auth,
    data: { type: 'character', name: SEED_NAME, thumbnail: IMG, metadata: { bible: { imageUrl: IMG, role: 'lead', sampleFaces: [] } } },
  });
  expect(create.ok()).toBeTruthy();
  const seeded = await create.json();
  const seededId = seeded.id || seeded.asset?.id;

  try {
    // 2) 路由契约:近似名 → 200 + 命中种子角色
    const sim = await request.get(`/api/global-assets/similar?q=${encodeURIComponent(NEAR_NAME)}&type=character&k=5`, { headers: auth });
    expect(sim.status()).toBe(200);
    const sj = await sim.json();
    expect(['vector', 'text']).toContain(sj.mode);
    expect(Array.isArray(sj.results)).toBeTruthy();
    expect(sj.results.some((r: any) => r.name === SEED_NAME)).toBeTruthy();

    // 3) UI:创作工坊填近似名 → 出现相似推荐 + 复用按钮
    await page.addInitScript(([t, u]) => {
      localStorage.setItem('qfmj-token', t as string);
      localStorage.setItem('qfmj-user', u as string);
      localStorage.setItem('qfmj-create-guide-done', '1');
    }, [token, JSON.stringify(user)] as [string, string]);
    await page.goto('/dashboard/create', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await page.getByLabel('角色名').first().fill(NEAR_NAME);
    const rec = page.locator('[data-testid="similar-character-rec"]');
    await expect(rec).toBeVisible({ timeout: 5000 });        // debounce 600ms + fetch
    await expect(rec.getByText(SEED_NAME)).toBeVisible();
    await expect(rec.getByRole('button', { name: /复用形象/ }).first()).toBeVisible();
  } finally {
    // 4) 清理种子
    if (seededId) await request.delete(`/api/global-assets/${seededId}`, { headers: auth }).catch(() => {});
  }
});
