#!/usr/bin/env tsx
/**
 * v6.6 — async repo 真连 Postgres 往返验证 (全量切换的"真"证据).
 *
 * pg-smoke 验的是裸 SQL; 这里验业务 repo: DB_DRIVER=pg 下, user-repo / project-repo
 * 的 create/get/list/update/delete 全部经 PgDriver 命中 PG. 跑完清理自己造的数据.
 *
 * 用法:  DB_DRIVER=pg DATABASE_URL=postgres://postgres:pw@localhost:5434/wind npm run pg:verify
 */

import { getDbDriver } from '../lib/db-driver';
import { createUser, findUserById, findUserByEmail, countUsers } from '../lib/repos/user-repo';
import { createProject, getProject, listProjectsByUser, updateProjectStatus, deleteProject } from '../lib/repos/project-repo';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('断言失败: ' + msg);
}

async function main() {
  const driver = getDbDriver();
  console.log(`🔌 DB driver = ${driver.dialect}`);
  assert(driver.dialect === 'postgres', '必须以 DB_DRIVER=pg 运行');

  const tag = Date.now();
  const email = `pgverify+${tag}@example.com`;
  let userId = '';
  let projectId = '';

  try {
  // ── user-repo 往返 ──
  const before = await countUsers();
  const u = await createUser({ email, passwordHash: 'hash', name: 'PG 验证用户' });
  userId = u.id;
  assert(u.subscription_tier === 'free', 'createUser 默认 free 档');
  const byId = await findUserById(userId);
  assert(byId?.email === email, 'findUserById 读回');
  const byEmail = await findUserByEmail(email);
  assert(byEmail?.id === userId, 'findUserByEmail 读回');
  assert((await countUsers()) === before + 1, 'countUsers +1');
  console.log('✅ user-repo create/findById/findByEmail/count (PG)');

  // ── project-repo 往返 ──
  const p = await createProject({ userId, title: 'PG 验证项目', description: '往返测试' });
  projectId = p.id;
  assert((await getProject(projectId))?.title === 'PG 验证项目', 'getProject 读回');
  const list = await listProjectsByUser(userId);
  assert(list.some((x) => x.id === projectId), 'listProjectsByUser 含新项目');
  assert(await updateProjectStatus(projectId, userId, 'active'), 'updateProjectStatus');
  assert((await getProject(projectId))?.status === 'active', '状态已改 active');
  console.log('✅ project-repo create/get/list/updateStatus (PG)');

  // ── 事务原语 ──
  const txOut = await driver.transaction(async (tx) => {
    const r = await tx.get<{ c: number }>('SELECT COUNT(*) AS c FROM users', []);
    return r?.c ?? 0;
  });
  assert(txOut >= 1, 'transaction 内查询');
  console.log('✅ DbDriver.transaction (PG client checkout)');

  console.log('\n🎉 全量切换验证通过 — auth/projects 域 async repo 在 Postgres 上工作正常.');
  process.exit(0);
} catch (e) {
  console.error('❌ verify 失败:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  // 清理自己造的数据
  try {
    if (projectId && userId) await deleteProject(projectId, userId);
    if (userId) await driver.run('DELETE FROM users WHERE id = ?', [userId]);
    console.log('🧹 已清理验证数据');
  } catch { /* ignore */ }
  }
}

main();
