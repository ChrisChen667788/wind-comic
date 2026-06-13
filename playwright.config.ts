import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (v10.3.x) —— 用系统 Chrome(channel: 'chrome',免下载 chromium 二进制):
 *   - smoke.spec:公开页渲染冒烟(desktop + mobile = 响应式)
 *   - a11y.spec:全站 axe a11y 审计(公开页 + 登录态 dashboard 页),无 critical/serious
 * 复用已在 :3000 跑的 dev server(reuseExistingServer)。跑法:`npm run test:e2e`。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000, // dashboard 页首次编译 + axe 偏慢,给足
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
    // e2e mint 的令牌与 server 须同一密钥;auth/lib.ts 无设值时用进程随机密钥(对不上)。
    // 自启 server 走这里;复用手动 server 时由启动命令带同名 env(见 .env.example)。
    env: { JWT_SECRET: process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod' },
  },
});
