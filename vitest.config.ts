import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // 多个测试文件共享同一个 better-sqlite3 文件 (data/qfmj.db),
    // 并行 worker 会触发 "database is locked". 强制单 fork 串行运行测试文件.
    // vitest 4.x: poolOptions 已上移到 test 顶层.
    pool: 'forks',
    forks: { singleFork: true },
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
