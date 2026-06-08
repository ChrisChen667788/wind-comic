import { test, expect } from '@playwright/test';

// 公开页(无需登录)渲染冒烟 —— desktop + mobile 两个 project 各跑一遍(响应式)。
const PUBLIC_PAGES: Array<{ path: string; mustSee: RegExp }> = [
  { path: '/', mustSee: /青枫|Wind Comic|AI Animation/i },
  { path: '/pricing', mustSee: /./ },
  { path: '/cases', mustSee: /./ },
  { path: '/auth', mustSee: /./ },
];

for (const p of PUBLIC_PAGES) {
  test(`renders ${p.path}`, async ({ page }) => {
    const resp = await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    expect(resp, `no response for ${p.path}`).toBeTruthy();
    expect(resp!.status(), `bad status for ${p.path}`).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(p.mustSee);
  });
}
