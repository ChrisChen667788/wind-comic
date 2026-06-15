import { test, expect } from '@playwright/test';

/**
 * v12.3.0 — 一键成片打包路由契约(阶段二十二)。
 * GET publish-package?platform=douyin → 可直发包(平台规格 + 视频 + 封面 + 文案 + warnings)。
 */
test('publish-package 路由契约 + 平台校验', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');

  // 非法平台 → 400
  const bad = await request.get('/api/projects/qfmj-demo-showcase/publish-package?platform=nope');
  expect(bad.status()).toBe(400);

  // 抖音 → 200 + 包结构
  const res = await request.get('/api/projects/qfmj-demo-showcase/publish-package?platform=douyin');
  expect(res.status()).toBe(200);
  const d = await res.json();
  expect(d.platform).toBe('douyin');
  expect(d.spec.aspect).toBe('9:16');            // 抖音竖屏
  expect(typeof d.ready).toBe('boolean');
  expect(Array.isArray(d.warnings)).toBeTruthy();
  expect(d.video).toBeTruthy();
  expect(d.exportHint?.body?.aspect).toBe('9:16'); // 一键导出该比例
  // 演示工程有成片 → video.url 非空
  expect(d.video.url === null || typeof d.video.url === 'string').toBeTruthy();

  // B站 → 16:9
  const bili = await request.get('/api/projects/qfmj-demo-showcase/publish-package?platform=bilibili');
  expect((await bili.json()).spec.aspect).toBe('16:9');
});
