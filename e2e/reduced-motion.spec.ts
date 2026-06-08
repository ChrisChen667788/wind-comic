import { test, expect, type Page } from '@playwright/test';

/**
 * v10.3.4 a11y: prefers-reduced-motion 运行时门禁。
 * 用 page.emulateMedia 切换偏好(比 test.use 在本仓更可靠),验证:
 *   - 减少动效:全局 CSS 把无限动画压到 ~0;<section> 内视频全部不自动播放(露静态封面)
 *   - 默认态:动画时长保留(门禁是条件性的,不是常关)
 */

// 注入带无限动画的探针,返回计算后的 animation-duration 秒数(不依赖业务类名)
async function probeDurationSeconds(page: Page): Promise<number> {
  const raw = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.animation = 'qfmjProbeSpin 8s linear infinite';
    document.body.appendChild(el);
    const d = getComputedStyle(el).animationDuration; // 例:'8s' | '1e-06s'
    el.remove();
    return d;
  });
  return raw.endsWith('ms') ? parseFloat(raw) / 1000 : parseFloat(raw);
}

test('减少动效:全局 CSS 把无限动画压到近 0', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await probeDurationSeconds(page)).toBeLessThan(0.05);
});

test('减少动效:<section> 内视频全部不自动播放', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const playing = await page.evaluate(() =>
    Array.from(document.querySelectorAll('section video')).filter((v) => !(v as HTMLVideoElement).paused).length,
  );
  expect(playing).toBe(0);
});

test('默认态(control):动画时长保留 ~8s', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await probeDurationSeconds(page)).toBeGreaterThan(5);
});
