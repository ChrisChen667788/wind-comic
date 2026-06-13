import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v11.2.0 — 项目/资产管理验收:建临时项目 → 下架 → 恢复 → 删除(级联)+ 越权拒绝。
 * 不动演示工程与真实数据 —— 全程用本测试自建的临时项目。
 */
const SECRET = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
function demo() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  return { uid: u.id, token: jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '1h' }) };
}

test('项目管理:下架 → 恢复 → 删除(级联) + 越权拒绝', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { uid, token } = demo();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 直接建一个临时项目(挂 demo 名下),避免触发生成流水线
  const pid = `e2e-mgr-${Date.now()}`;
  const db = new Database('data/qfmj.db');
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, '管理e2e临时', '', '[]', 'completed', ?, ?)`)
    .run(pid, uid, new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at) VALUES (?, ?, 'storyboard', '镜1', '{}', '["/x.png"]', null, 1, 1, ?, ?)`)
    .run(`a-${pid}`, pid, new Date().toISOString(), new Date().toISOString());
  db.close();

  // 下架
  const arch = await request.patch(`/api/projects/${pid}`, { headers: auth, data: { status: 'archived' } });
  expect(arch.status()).toBe(200);
  let row = new Database('data/qfmj.db', { readonly: true });
  expect((row.prepare('SELECT status FROM projects WHERE id=?').get(pid) as any).status).toBe('archived');
  row.close();

  // 恢复
  const restore = await request.patch(`/api/projects/${pid}`, { headers: auth, data: { status: 'active' } });
  expect(restore.status()).toBe(200);

  // 越权删除被拒(他人 token)
  const otherTok = jwt.sign({ sub: 'nobody-else', role: 'user' }, SECRET, { expiresIn: '1h' });
  const forbid = await request.delete(`/api/projects/${pid}`, { headers: { Authorization: `Bearer ${otherTok}` } });
  expect(forbid.status()).toBe(403);

  // 属主删除 → 级联(项目 + 资产都没了)
  const del = await request.delete(`/api/projects/${pid}`, { headers: auth });
  expect(del.status()).toBe(200);
  const after = new Database('data/qfmj.db', { readonly: true });
  expect(after.prepare('SELECT id FROM projects WHERE id=?').get(pid)).toBeFalsy();
  expect(after.prepare("SELECT id FROM project_assets WHERE project_id=?").get(pid)).toBeFalsy();
  after.close();
});

test('资产管理:删除单资产 + 越权拒绝', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { uid, token } = demo();
  const auth = { Authorization: `Bearer ${token}` };

  const pid = `e2e-asset-${Date.now()}`;
  const aid = `a-${pid}`;
  const db = new Database('data/qfmj.db');
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, '资产e2e临时', '', '[]', 'completed', ?, ?)`)
    .run(pid, uid, new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at) VALUES (?, ?, 'storyboard', '镜1', '{}', '["/x.png"]', null, 1, 1, ?, ?)`)
    .run(aid, pid, new Date().toISOString(), new Date().toISOString());
  db.close();

  // 越权删资产被拒
  const otherTok = jwt.sign({ sub: 'nobody-else-2', role: 'user' }, SECRET, { expiresIn: '1h' });
  const forbid = await request.delete(`/api/assets?id=${aid}`, { headers: { Authorization: `Bearer ${otherTok}` } });
  expect(forbid.status()).toBe(403);

  // 属主删资产
  const del = await request.delete(`/api/assets?id=${aid}`, { headers: auth });
  expect(del.status()).toBe(200);
  const after = new Database('data/qfmj.db', { readonly: true });
  expect(after.prepare('SELECT id FROM project_assets WHERE id=?').get(aid)).toBeFalsy();
  after.close();

  // 清理临时项目
  await request.delete(`/api/projects/${pid}`, { headers: auth });
});
