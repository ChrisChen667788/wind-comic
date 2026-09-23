/**
 * v12.449 · SQLite 单连接上的事务必须排队(真库:测试进程的临时 SQLite)。
 *
 * 修前:两个事务交错 → 后一个 BEGIN 抛「cannot start a transaction within a transaction」,
 * 它的 catch 再 ROLLBACK,把先开的事务一起回滚;先开的那个随后 COMMIT 又因没有活动事务失败 —— 两边全挂。
 * v12.448 用真库测「同一镜并发保存参考视频」撞出,全仓 13 处 transaction() 调用同一处境。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { getDbDriver } from '@/lib/db-driver';
import { createProject } from '@/lib/repos/project-repo';
import { saveStageScene } from '@/lib/stage-scene-store';

const T = 'tx_probe_v12449';
const tick = () => new Promise((r) => setTimeout(r, 1)); // 真让出执行权 —— 修前交错就发生在这种 await 上

beforeAll(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS ${T} (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT, seen INTEGER)`);
});

describe('v12.449 · 并发事务排队', () => {
  it('10 个并发事务(事务内会让出执行权)全部成功,且依次执行 —— 每个都看到前一个已提交的结果', async () => {
    db.exec(`DELETE FROM ${T}`);
    const drv = getDbDriver();
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => drv.transaction(async (tx) => {
      const before = (await tx.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T}`))!.n;
      await tick();
      await tx.run(`INSERT INTO ${T} (tag, seen) VALUES (?, ?)`, [`t${i}`, before]);
      return before;
    })));
    expect(results.filter((r) => r.status === 'rejected'), JSON.stringify(results.filter((r) => r.status === 'rejected'))).toEqual([]);
    const seen = (db.prepare(`SELECT seen FROM ${T} ORDER BY id`).all() as any[]).map((r) => r.seen);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('一个事务失败只回滚它自己;排在后面的照常提交', async () => {
    db.exec(`DELETE FROM ${T}`);
    const drv = getDbDriver();
    const [a, b] = await Promise.allSettled([
      drv.transaction(async (tx) => { await tx.run(`INSERT INTO ${T} (tag) VALUES ('bad')`); await tick(); throw new Error('boom'); }),
      drv.transaction(async (tx) => { await tick(); await tx.run(`INSERT INTO ${T} (tag) VALUES ('good')`); return 'ok'; }),
    ]);
    expect(a.status).toBe('rejected');
    expect((a as PromiseRejectedResult).reason.message).toBe('boom');
    expect(b).toEqual({ status: 'fulfilled', value: 'ok' });
    expect((db.prepare(`SELECT tag FROM ${T}`).all() as any[]).map((r) => r.tag)).toEqual(['good']);
  });

  it('嵌套事务立即报清楚的错,而不是排队自己等自己挂死', async () => {
    const drv = getDbDriver();
    const nested = drv.transaction(async () => drv.transaction(async () => 'inner'));
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('挂死:嵌套事务在排队等自己')), 3000));
    await expect(Promise.race([nested, timeout])).rejects.toThrow(/嵌套事务/);
    // 报错之后队列没被堵死
    await expect(drv.transaction(async () => 'after')).resolves.toBe('after');
  });

  it('真实调用方:同一镜并发保存导演台站位 → 全部成功,只留一行', async () => {
    const uid = 'u-' + nanoid(8);
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`).run(uid, `${uid}@t.local`, 'x', 't', now());
    const pid = (await createProject({ userId: uid, title: 'tx', description: 'd', coverUrls: [] }) as any).id;
    const scene = (x: number) => ({ shotNumber: 3, camera: { x: 0, z: -5, yawDeg: 0, lens: 35 }, actors: [{ id: 'a', name: '林晚', x, z: 0 }] }) as any;
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => saveStageScene(pid, scene(i))));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM project_assets WHERE project_id = ? AND type = 'stage-scene' AND shot_number = 3`).get(pid) as any;
    expect(rows.n).toBe(1);
  });
});
