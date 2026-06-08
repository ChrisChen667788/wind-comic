import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// 公开页(无需登录)—— 在 desktop + mobile 两个 project 各跑一遍(响应式冒烟)。
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

// a11y 审计(axe · WCAG 2 A/AA)。门禁:**无 critical 且无 serious**。
// v10.3.2 对比度走查后,落地页 color-contrast 已清零(--soft/--muted 提亮达标),
// 故门禁收紧到 serious 也必须为 0 —— 锁死对比度,防回归。
test('landing a11y audit (no critical/serious WCAG 2A/AA)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (blocking.length) {
    console.log('a11y blocking:', blocking.map((v) => `${v.id}×${v.nodes.length}`).join(', '));
  }
  expect(blocking.map((v) => v.id), 'landing 不应有 critical/serious a11y 违规').toEqual([]);
});
