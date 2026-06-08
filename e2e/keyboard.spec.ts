import { test, expect } from '@playwright/test';

/**
 * v10.3.5 a11y: 键盘焦点门禁。
 * 验证「跳到主内容」skip link 是页面第一个可聚焦元素,激活后焦点落到 #main-content,
 * 且每个公开门禁页都存在该锚点(焦点顺序的入口)。
 */

test('skip link 是页面第一个可聚焦元素(Tab 即达)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { href: el?.getAttribute('href') ?? null, text: el?.textContent?.trim() ?? '' };
  });
  expect(first.href).toBe('#main-content');
  expect(first.text).toContain('跳到主内容');
});

test('激活 skip link 后焦点落在 #main-content', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // 等 React 水合:未水合前 onClick 未挂,el.click() 会走原生跳转
  // 真实浏览器里 Enter 会对链接派发 click;headless 下 Enter 不必触发 JS click,
  // 故直接 el.click()(走与真实 Enter 相同的 onClick 路径),同一 evaluate 内同步读焦点。
  const movedId = await page.locator('a[href="#main-content"]').evaluate((el) => {
    (el as HTMLElement).click();
    return document.activeElement?.id ?? '';
  });
  expect(movedId).toBe('main-content');
});

for (const path of ['/', '/pricing', '/cases', '/auth']) {
  test(`#main-content 锚点存在且可聚焦 — ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const target = await page.evaluate(() => {
      const el = document.getElementById('main-content');
      return el ? { exists: true, tabindex: el.getAttribute('tabindex') } : { exists: false, tabindex: null };
    });
    expect(target.exists).toBe(true);
    expect(target.tabindex).toBe('-1');
  });
}
