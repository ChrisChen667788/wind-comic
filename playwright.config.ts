import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (v10.3.0) —— 用系统 Chrome(channel: 'chrome',免下载 chromium 二进制)对公开页跑:
 *   - 渲染冒烟(页面 200 + 关键文案在)
 *   - axe a11y 审计(无 critical/serious 违规)
 *   - 响应式(同一批冒烟在 mobile 视口再跑一遍,验窄屏不崩)
 * 复用已在 :3000 跑的 dev server(reuseExistingServer)。跑法:`npm run test:e2e`。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    channel: 'chrome',
    headless: true,
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
