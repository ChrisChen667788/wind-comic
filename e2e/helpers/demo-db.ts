import Database from 'better-sqlite3';
import type { APIRequestContext } from '@playwright/test';

/**
 * 直连开发服务器正在用的库(data/qfmj.db)拿 demo 账号 —— 导演台走查与 3D 走查在这里种一次性项目。
 *
 * 本机跑时库早就在;CI 上是全新检出,**库文件要等 dev server 第一次加载 lib/db 才建表并种下 demo 账号**
 * (Playwright 只等首页能打开,首页不一定碰库)。所以先打一个会加载 lib/db 的接口(未登录 401 也行),再等账号出现。
 * 注意服务器不能带 NODE_ENV=test 起:那样 lib/db 用每进程一个的随机库,与这里读的不是同一个文件。
 */
export async function openDemoDb(request: APIRequestContext): Promise<{ db: Database.Database; user: { id: string; role: string } }> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const db = new Database('data/qfmj.db');
    try {
      const user = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as { id: string; role: string } | undefined;
      if (user) return { db, user };
    } catch { /* 表还没建 */ }
    db.close();
    if (Date.now() > deadline) {
      throw new Error('data/qfmj.db 里没有 demo 账号:dev server 没建库(是否带了 NODE_ENV=test?)或设了 SEED_DEMO_USER=0');
    }
    await request.get('/api/projects', { timeout: 120_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
}
