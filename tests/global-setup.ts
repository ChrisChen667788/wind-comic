import fs from 'fs';
import path from 'path';

/**
 * Vitest globalSetup —— 整批测试开始前, 在主进程"一次性"清掉上一次 run 残留的测试库文件.
 *
 * 配合 lib/db.ts: 那里测试时每个测试文件用一个独占的随机库文件
 * `qfmj.test.<pid>.<id>.db`(永不与别的连接/进程共用同一文件, 从而消除 unlink+重建
 * WAL 库与残留连接竞争导致的偶发 "disk I/O error" / "database is locked").
 * 单个库文件因此不再自我清理(避免删到仍被占用的文件), 残留集中在这里清理:
 * 主进程、跑任何测试文件之前、只跑一次 → 不存在并发/竞争.
 *
 * 只删 `qfmj.test*`(测试库), 永不碰生产 `qfmj.db`.
 */
function sweepTestDbs() {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    for (const f of fs.readdirSync(dataDir)) {
      if (f.startsWith('qfmj.test')) {
        try { fs.unlinkSync(path.join(dataDir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* data 目录不存在等, 忽略 */ }
}

export default function setup() {
  sweepTestDbs(); // 跑前: 清上一次 run 的残留
  // 返回的函数是 globalSetup 的 teardown: 整批测试结束、worker 退出后在主进程跑一次,
  // 把本次 run 产生的一堆 qfmj.test.<pid>.<id>.db 收掉, 避免堆积在 data/.
  return () => { sweepTestDbs(); };
}
