/**
 * v12.442 —— 构建期不许多个进程抢同一个 sqlite 文件。
 *
 * 真实事故:v12.441 的 Docker `build (linux/arm64)` 红了 ——
 *   `Error: Failed to collect page data for /api/auth/login` → `SqliteError: database is locked`。
 * `next build` 起多个 worker 并行收集页面数据,每个 worker 导入 lib/db 都会对同一个
 * data/qfmj.db 建表 + 跑迁移(全是写)。arm64 在 QEMU 下更慢,busy_timeout 5s 等不到就抛。
 * 这是**竞争**不是必现 —— 所以不能靠「再跑一次绿了」当修好了,得让构建期各进程用各自的库。
 *
 * 这里不去赌「共享时一定锁死」(在快盘上可能侥幸不锁),而是锁住那个**必要条件**:
 * 共享模式下 N 个进程指向同一个文件,构建模式下 N 个进程各自一个文件、且都不在 cwd/data 下。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.cwd();
/** 在独立 cwd 里起一个真进程导入 lib/db,回报它实际用的库文件 */
function dbPathIn(cwd: string, env: Record<string, string>): string {
  const out = execFileSync(
    'npx',
    ['tsx', '-e', `import(${JSON.stringify(path.join(REPO, 'lib/db.ts'))}).then(m => console.log('DBPATH=' + m.dbPath))`],
    { cwd, env: { ...process.env, VITEST: '', NODE_ENV: 'production', ...env }, encoding: 'utf-8', timeout: 120000 },
  );
  const line = out.split('\n').find((l) => l.startsWith('DBPATH='));
  if (!line) throw new Error(`子进程没报出库路径:\n${out.slice(-400)}`);
  return line.slice('DBPATH='.length).trim();
}

describe('v12.442 · 构建期各进程一个独占库', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qfmj-buildtest-')));

  it('运行时:仍是 cwd/data/qfmj.db(生产行为零变化)', () => {
    const p = dbPathIn(tmp, {});
    expect(p).toBe(path.join(tmp, 'data', 'qfmj.db'));
  }, 180000);

  it('构建期(NEXT_PHASE / QFMJ_EPHEMERAL_DB 任一):三个进程三个库,且都不在 cwd/data 下', () => {
    const a = dbPathIn(tmp, { NEXT_PHASE: 'phase-production-build' });
    const b = dbPathIn(tmp, { NEXT_PHASE: 'phase-production-build' });
    const c = dbPathIn(tmp, { QFMJ_EPHEMERAL_DB: '1' });
    expect(new Set([a, b, c]).size, '同一路径 = 竞争同一把锁,正是构建红掉的必要条件').toBe(3);
    for (const p of [a, b, c]) {
      expect(p.startsWith(path.join(tmp, 'data')), `${p} 不该落在项目数据目录`).toBe(false);
      expect(p).toContain('qfmj-build-');
    }
  }, 300000);

  it('构建进程退出后临时库自己清掉(一次构建会起几十个 worker,不能在 /tmp 里堆积)', () => {
    const p = dbPathIn(tmp, { QFMJ_EPHEMERAL_DB: '1' });
    expect(p).toContain('qfmj-build-');
    expect(fs.existsSync(path.dirname(p)), '子进程已退出,目录该没了').toBe(false);
  }, 180000);

  it('Dockerfile:builder 阶段置位,runner 阶段不带(运行时必须用真库)', () => {
    const df = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf-8');
    const builder = df.slice(df.indexOf('AS builder'), df.indexOf('AS runner'));
    const runner = df.slice(df.indexOf('AS runner'));
    // 先自证窗口切对了 —— 否则 runner 切成空串,下面那条 not.toContain 会静默通过
    expect(builder, 'builder 段应含构建命令').toContain('RUN npm run build');
    expect(runner, 'runner 段应含运行时入口').toMatch(/CMD |ENTRYPOINT /);
    expect(builder).toContain('QFMJ_EPHEMERAL_DB=1');
    expect(runner).not.toContain('QFMJ_EPHEMERAL_DB');
    expect(builder.indexOf('QFMJ_EPHEMERAL_DB'), '要在 npm run build 之前置位').toBeLessThan(builder.indexOf('RUN npm run build'));
  });
});
