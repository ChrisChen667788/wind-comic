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

// a11y 审计(axe · WCAG 2 A/AA)。硬门禁:**无 critical**(最严重、必修);
// serious(本站主要是深色主题的 color-contrast — 与刻意的"低调灰字"美学冲突)
// 记录追踪、不阻断构建,待专门的设计走查再调对比度。
test('landing a11y audit (gate: no critical; track serious)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  const serious = results.violations.filter((v) => v.impact === 'serious');
  console.log('a11y critical:', critical.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none');
  console.log('a11y serious (tracked):', serious.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none');
  expect(critical.map((v) => v.id), 'critical a11y 违规必须为 0').toEqual([]);
});
