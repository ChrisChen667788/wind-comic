import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.6.1 — 资产连续性台账验收(用《雨夜信号》演示工程):
 * GET 自动登记 → PUT 改「程一帆 · 服装」描述 → 受影响镜头 [1,2,4] → DB 对应分镜 stale=1。
 */

function mint() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  return jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' });
}

test('台账:登记 → 改服装描述 → 受影响镜头清单 + stale 落库', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const token = mint();
  const auth = { Authorization: `Bearer ${token}` };
  const pid = 'qfmj-demo-showcase';

  // 确保演示工程在位(幂等导入会还原出厂 stale=0)
  await request.post('/api/demo-project', { headers: auth });

  // GET:自动登记(服装×2 / 场景×2)
  const got = await request.get(`/api/projects/${pid}/asset-ledger`);
  expect(got.status()).toBe(200);
  const ledger = await got.json();
  const cyf = ledger.entries.find((e: any) => e.id === 'costume:程一帆');
  expect(cyf, '程一帆服装条目应自动登记').toBeTruthy();
  expect(cyf.shotNumbers).toEqual([1, 2, 4]); // 出场镜

  // PUT:改服装描述 → 受影响镜头清单(验收原文)
  const put = await request.put(`/api/projects/${pid}/asset-ledger`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { entryId: 'costume:程一帆', description: '深蓝雨衣 · 无围巾(第二集换装)' },
  });
  expect(put.status()).toBe(200);
  const r = await put.json();
  expect(r.affectedShots).toEqual([1, 2, 4]);
  expect(r.staleMarked).toBeGreaterThan(0);

  // DB:受影响镜头的分镜置 stale=1,未受影响的镜 3 仍为 0
  const db = new Database('data/qfmj.db', { readonly: true });
  const rows = db.prepare(
    "SELECT shot_number, stale FROM project_assets WHERE project_id = ? AND type = 'storyboard'",
  ).all(pid) as Array<{ shot_number: number; stale: number }>;
  db.close();
  const byShot = Object.fromEntries(rows.map((x) => [x.shot_number, x.stale]));
  expect(byShot[1]).toBe(1);
  expect(byShot[2]).toBe(1);
  expect(byShot[4]).toBe(1);
  expect(byShot[3]).toBe(0); // 苏雨眠的镜不受影响
});
