import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * v12.458:**会原地改真实源文件的测试,必须等其余测试全部跑完再单独跑**。
 *
 * `tests/v12-396-mutation-probe.test.ts` 调 scripts/mutation-probe.mjs 把 lib/genre-vocab.ts 的 isSad
 * 改成恒 false、跑目标测试、再还原 —— 那几秒里,并行 worker 上任何加载 genre-vocab 的测试
 * (v12-362 的 isSad 用例、prompt-templates 的「悲情基调」)都会拿到变异版而变红。
 * v12.456/457 发版期间 6 次全量撞了 3 次,每次都是这 6 条。
 * 用 projects + sequence.groupOrder:主套件是第 0 组,这些测试是第 1 组 —— 组与组严格先后,
 * 探针改文件时已经没有别的测试在跑。探针本身的四项保证(真改、真红、逐字节还原、坏参数退 2)不变。
 * 以后再有「改真实源文件」的测试,加进这个清单即可(tests/v12-458-* 会校验它确实被隔离)。
 */
export const SOURCE_MUTATING_TESTS = ['tests/v12-396-mutation-probe.test.ts'];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // e2e/ 是 Playwright 规约(.spec.ts),用 playwright test 跑,排除出 vitest。
    // v12.321:`.claude/**` 必须排除 —— 装进来的技能包自带 *.test.mjs,被收进来后
    // 收集期就抛 ERR_INVALID_URL_SCHEME,**把整份清单截断**(实测 4131 → 683),
    // 而 sync-doc-stats 会把这个数字写进 README 徽章。第三方技能的测试不是本仓门禁。
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'],
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
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**', ...SOURCE_MUTATING_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'source-mutating',
          include: SOURCE_MUTATING_TESTS,
          sequence: { groupOrder: 1 },
        },
      },
    ],
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
