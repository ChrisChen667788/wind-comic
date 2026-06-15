import { test, expect } from '@playwright/test';

/**
 * v12.2.4 — 身份漂移检测路由契约(阶段二十一收官)。
 * 无 IMAGE_EMBED_MODEL(默认/MOCK)→ available:false + reason(诚实降级,退回 LLM 评分)。
 * 漂移算法本身由 tests/v12-2-4-drift-detect 单测锁;此处锁路由契约 + 降级。
 */
test('drift-check 路由契约 + 诚实降级', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const res = await request.get('/api/projects/qfmj-demo-showcase/drift-check');
  expect(res.status()).toBe(200);
  const d = await res.json();
  expect(typeof d.available).toBe('boolean');
  if (!d.available) {
    expect(typeof d.reason).toBe('string');       // 降级须给原因
    expect(d.reason.length).toBeGreaterThan(0);
  } else {
    expect(Array.isArray(d.outliers)).toBeTruthy();
    expect(Array.isArray(d.scores)).toBeTruthy();
  }
});
