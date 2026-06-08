import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // e2e/ 是 Playwright 规约(.spec.ts),用 playwright test 跑,排除出 vitest。
    exclude: [...configDefaults.exclude, 'e2e/**'],
    setupFiles: ['./tests/setup.ts'],
    // 整批测试前在主进程一次性清掉上一次 run 残留的测试库文件 (见 tests/global-setup.ts).
    // lib/db.ts 测试时每个文件用一个独占随机库文件, 不自我清理, 残留集中在此一次性清.
    globalSetup: ['./tests/global-setup.ts'],
    // 多个测试文件共享同一个 better-sqlite3 文件 (data/qfmj.db),
    // 并行 worker 会触发 "database is locked". 强制单 fork 串行运行测试文件.
    // vitest 4.x: poolOptions 已上移到 test 顶层.
    pool: 'forks',
    forks: { singleFork: true },
    // v3.2 P3.3: singleFork 即使串行执行测试文件, 同进程内多个 better-sqlite3
    // 实例还是偶尔互相 lock (WAL contention). 给 retry=1, 真正 broken 的会两次都挂.
    retry: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.ts',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
