/**
 * v12.451 · 演示工程每人一份(真库)。
 *
 * 修前全站只有一个固定项目号 `qfmj-demo-showcase`:
 *  - 只有第一个导入的人能打开;之后任何人点「导入」都被跳到一个自己无权访问的项目;
 *  - 更糟的是,那一下会把第一个人的演示工程**重置成出厂状态**(updateProjectById 不看归属)——
 *    v12.448 第三轮全仓越权扫描查实的唯一一处。
 * GET 也是全站一个答案:别人导入过,你的按钮就显示「已导入」。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import { NextRequest } from 'next/server';
import { db, now } from '@/lib/db';
import { importDemoProject, resolveDemoProjectId, perUserDemoId, isDemoProjectId, DEMO_PROJECT_ID } from '@/lib/demo-project';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { signToken } from '@/app/api/auth/lib';

const mkUser = () => {
  const id = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(id, `${id}@test.local`, 'x', id, now());
  return id;
};
const wipe = (pid: string) => {
  db.prepare('DELETE FROM project_assets WHERE project_id = ?').run(pid);
  db.prepare('DELETE FROM project_quality_scores WHERE project_id = ?').run(pid);
  db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
};
const owner = (pid: string) => (db.prepare('SELECT user_id FROM projects WHERE id = ?').get(pid) as any)?.user_id;
const assetCount = (pid: string) => (db.prepare('SELECT count(*) c FROM project_assets WHERE project_id = ?').get(pid) as any).c;

beforeEach(() => { wipe(DEMO_PROJECT_ID); });

describe('v12.451 · 每人一份', () => {
  it('第一个导入的人沿用固定号(单用户自部署与 e2e 零变化)', async () => {
    const a = mkUser();
    const r = await importDemoProject(a);
    expect(r).toEqual({ projectId: DEMO_PROJECT_ID, refreshed: false });
    expect(owner(DEMO_PROJECT_ID)).toBe(a);
  });

  it('第二个人拿到自己的一份,且打得开', async () => {
    const a = mkUser(); const b = mkUser();
    await importDemoProject(a);
    const r = await importDemoProject(b);
    expect(r.projectId).toBe(perUserDemoId(b));
    expect(r.projectId).not.toBe(DEMO_PROJECT_ID);
    expect(r.refreshed).toBe(false);
    expect(await getOwnedProject(r.projectId, b), 'B 必须能打开跳过去的那个项目').not.toBeNull();
    expect(assetCount(r.projectId)).toBe(assetCount(DEMO_PROJECT_ID));
    wipe(r.projectId);
  });

  it('第二个人导入不碰第一个人的那份(修前会重置成出厂)', async () => {
    const a = mkUser(); const b = mkUser();
    await importDemoProject(a);
    // A 在自己的演示工程上动过手
    db.prepare("UPDATE projects SET script_data = ?, status = 'draft' WHERE id = ?").run('{"title":"A 改过的剧本"}', DEMO_PROJECT_ID);
    db.prepare('UPDATE project_assets SET stale = 1 WHERE project_id = ?').run(DEMO_PROJECT_ID);
    const before = db.prepare('SELECT script_data, status, updated_at FROM projects WHERE id = ?').get(DEMO_PROJECT_ID);

    const r = await importDemoProject(b);

    expect(db.prepare('SELECT script_data, status, updated_at FROM projects WHERE id = ?').get(DEMO_PROJECT_ID)).toEqual(before);
    expect((db.prepare('SELECT count(*) c FROM project_assets WHERE project_id = ? AND stale = 0').get(DEMO_PROJECT_ID) as any).c,
      'B 的「还原出厂」不能把 A 的失效标记清掉').toBe(0);
    expect(owner(DEMO_PROJECT_ID)).toBe(a);
    wipe(r.projectId);
  });

  it('同一个人重复导入落在同一份上:刷新还原、资产不翻倍', async () => {
    const a = mkUser(); const b = mkUser();
    await importDemoProject(a);
    const r1 = await importDemoProject(b);
    const n = assetCount(r1.projectId);
    const r2 = await importDemoProject(b);
    expect(r2).toEqual({ projectId: r1.projectId, refreshed: true });
    expect(assetCount(r1.projectId)).toBe(n);
    const ra = await importDemoProject(a);
    expect(ra).toEqual({ projectId: DEMO_PROJECT_ID, refreshed: true });
    wipe(r1.projectId);
  });

  it('固定号的主人删掉项目后:已有自己那份的人不会多出第二份;新来的人认领固定号', async () => {
    const a = mkUser(); const b = mkUser(); const c = mkUser();
    await importDemoProject(a);
    const rb = await importDemoProject(b);
    wipe(DEMO_PROJECT_ID); // A 删了
    const rb2 = await importDemoProject(b);
    expect(rb2).toEqual({ projectId: rb.projectId, refreshed: true });
    expect(owner(DEMO_PROJECT_ID), 'B 不该顺手又认领固定号').toBeUndefined();
    const rc = await importDemoProject(c);
    expect(rc).toEqual({ projectId: DEMO_PROJECT_ID, refreshed: false });
    wipe(rb.projectId);
  });

  it('两人同时首次导入:都成功、各得一份、各归各', async () => {
    const a = mkUser(); const b = mkUser();
    const [ra, rb] = await Promise.all([importDemoProject(a), importDemoProject(b)]);
    expect(ra.projectId).not.toBe(rb.projectId);
    expect(owner(ra.projectId)).toBe(a);
    expect(owner(rb.projectId)).toBe(b);
    expect([ra.projectId, rb.projectId]).toContain(DEMO_PROJECT_ID);
    for (const r of [ra, rb]) if (r.projectId !== DEMO_PROJECT_ID) wipe(r.projectId);
  });

  it('哈希撞上别人的项目时宁可报错,也不写进去', async () => {
    const a = mkUser(); const b = mkUser(); const x = mkUser();
    await importDemoProject(a);
    // 伪造:B 的号被 X 占了
    db.prepare(`INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, 'X 的项目', 'draft', ?, ?)`)
      .run(perUserDemoId(b), x, now(), now());
    await expect(importDemoProject(b)).rejects.toThrow(/已被其他用户占用/);
    expect((db.prepare('SELECT title FROM projects WHERE id = ?').get(perUserDemoId(b)) as any).title).toBe('X 的项目');
    wipe(perUserDemoId(b));
  });

  it('项目号判定:固定号与每人一份的号都算演示工程,别的不算', () => {
    expect(isDemoProjectId(DEMO_PROJECT_ID)).toBe(true);
    expect(isDemoProjectId(perUserDemoId('whoever'))).toBe(true);
    expect(isDemoProjectId('qfmj-demo-showcase-x')).toBe(false);
    expect(isDemoProjectId('qfmj-demo-ZZZZ')).toBe(false);
    expect(isDemoProjectId('proj-123')).toBe(false);
  });
});

describe('v12.451 · GET 按登录用户答', () => {
  const call = async (sub?: string) => {
    const { GET } = await import('@/app/api/demo-project/route');
    const headers: Record<string, string> = {};
    if (sub) headers.authorization = `Bearer ${signToken({ id: sub, role: 'user' } as any)}`;
    const res = await GET(new NextRequest('http://localhost/api/demo-project', { headers }));
    return res.json();
  };

  it('各自看到各自的;没导入过的看到「未导入」;未登录看到「未导入」', async () => {
    const a = mkUser(); const b = mkUser(); const c = mkUser();
    await importDemoProject(a);
    const rb = await importDemoProject(b);
    expect(await call(a)).toEqual({ imported: true, projectId: DEMO_PROJECT_ID });
    expect(await call(b)).toEqual({ imported: true, projectId: rb.projectId });
    expect(await call(c), '修前:别人导入过,C 也显示「已导入」').toEqual({ imported: false, projectId: null });
    expect(await call()).toEqual({ imported: false, projectId: null });
    wipe(rb.projectId);
  });
});
