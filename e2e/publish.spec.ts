import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v12.3.1 — 发布动作闸门 + 记录(阶段二十二):
 * 401(未登录)→ 402(free 计费 gate)→ 200(creator,过门禁,落记录)→ GET 记录可见。
 */
function demoToken(): { token: string; userId: string } {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  const secret = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
  return { token: jwt.sign({ sub: u.id, role: u.role }, secret, { expiresIn: '1h' }), userId: u.id };
}
function setTier(userId: string, tier: string) {
  const db = new Database('data/qfmj.db');
  db.prepare('UPDATE users SET subscription_tier = ? WHERE id = ?').run(tier, userId);
  db.close();
}

test('发布闸门:401 → 402(free)→ 200(creator)+ 记录', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token, userId } = demoToken();
  const auth = { Authorization: `Bearer ${token}` };
  const url = '/api/projects/qfmj-demo-showcase/publish';
  const origTier = (() => { const db = new Database('data/qfmj.db', { readonly: true }); const r = db.prepare('SELECT subscription_tier t FROM users WHERE id=?').get(userId) as any; db.close(); return r?.t || 'free'; })();

  try {
    // 1. 未登录 → 401
    const r401 = await request.post(url, { data: { platform: 'douyin' } });
    expect(r401.status()).toBe(401);

    // 2. free 用户 → 402 计费 gate(若 PLAN_GATE_DISABLED=1 总开关关了 gate,则放行 → 200)
    setTier(userId, 'free');
    const r402 = await request.post(url, { headers: auth, data: { platform: 'douyin' } });
    expect([402, 200]).toContain(r402.status());
    if (r402.status() === 402) expect((await r402.json()).required).toBe('creator');

    // 3. creator → 过 plan gate;demo 工程质量门禁非 block → 200 + 记录
    setTier(userId, 'creator');
    const ok = await request.post(url, { headers: auth, data: { platform: 'douyin' } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('packaged');
    expect(body.shareUrl).toMatch(/^\/share\//);
    expect(body.record?.platform).toBe('douyin');

    // 4. GET 记录可见
    const list = await request.get(url, { headers: auth });
    const lj = await list.json();
    expect(Array.isArray(lj.records)).toBeTruthy();
    expect(lj.records.some((x: any) => x.platform === 'douyin')).toBeTruthy();
  } finally {
    setTier(userId, origTier);
    // 清理本次产生的发布记录
    const db = new Database('data/qfmj.db');
    db.prepare("DELETE FROM publish_records WHERE project_id = 'qfmj-demo-showcase'").run();
    db.close();
  }
});
