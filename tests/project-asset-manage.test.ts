/**
 * v11.2.0 — 项目/资产管理单测:级联删除 + 归档 + 属主守卫(真 DB)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { insertProjectFull, deleteProjectCascade, setProjectArchived, getOwnedProject } from '@/lib/repos/project-repo';
import { createAsset, listAssetsByType, getAsset, deleteAsset } from '@/lib/repos/asset-repo';

const OWNER = 'u-mgr-owner';
const OTHER = 'u-mgr-other';

beforeAll(() => {
  const ins = db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`);
  for (const [id, email] of [[OWNER, 'mgr-owner@test.dev'], [OTHER, 'mgr-other@test.dev']] as const) {
    ins.run(id, email, 'x', id, new Date().toISOString());
  }
});

describe('v11.2.0 · deleteProjectCascade', () => {
  it('删项目时级联清子表;属主守卫拒删他人项目', async () => {
    const pid = 'p-cascade-1';
    await insertProjectFull({ id: pid, userId: OWNER, title: '级联测试', description: '', coverUrls: [], status: 'completed', primaryCharacterRef: null, lockedCharacters: [] });
    await createAsset({ projectId: pid, type: 'storyboard', name: '镜1', data: {}, mediaUrls: ['/a.png'], shotNumber: 1 });
    await createAsset({ projectId: pid, type: 'video', name: '镜1视频', data: {}, mediaUrls: ['/a.mp4'], shotNumber: 1 });
    db.prepare(`INSERT INTO project_quality_scores (id, project_id, overall_score, continuity_score, lighting_score, face_score, created_at) VALUES (?, ?, 80, 80, 80, 80, ?)`)
      .run('qs-cascade-1', pid, new Date().toISOString());

    expect((await listAssetsByType(pid, 'storyboard')).length).toBe(1);

    // 他人不能删
    expect(await deleteProjectCascade(pid, OTHER)).toBe(false);
    expect(db.prepare('SELECT id FROM projects WHERE id=?').get(pid)).toBeTruthy();

    // 属主删 → 项目 + 子表全清
    expect(await deleteProjectCascade(pid, OWNER)).toBe(true);
    expect(db.prepare('SELECT id FROM projects WHERE id=?').get(pid)).toBeFalsy();
    expect((await listAssetsByType(pid, 'storyboard')).length).toBe(0);
    expect((await listAssetsByType(pid, 'video')).length).toBe(0);
    expect(db.prepare('SELECT id FROM project_quality_scores WHERE project_id=?').get(pid)).toBeFalsy();
  });

  it('无 userId(管理/清理路径)直接删,不守卫', async () => {
    const pid = 'p-cascade-2';
    await insertProjectFull({ id: pid, userId: OWNER, title: 'x', description: '', coverUrls: [], status: 'completed', primaryCharacterRef: null, lockedCharacters: [] });
    expect(await deleteProjectCascade(pid)).toBe(true);
  });
});

describe('v11.2.0 · setProjectArchived', () => {
  it('下架置 status=archived;恢复置 completed;属主守卫', async () => {
    const pid = 'p-arch-1';
    await insertProjectFull({ id: pid, userId: OWNER, title: 'arch', description: '', coverUrls: [], status: 'completed', primaryCharacterRef: null, lockedCharacters: [] });

    expect(await setProjectArchived(pid, OTHER, true)).toBe(false); // 他人不能下架
    expect(await setProjectArchived(pid, OWNER, true)).toBe(true);
    expect((db.prepare('SELECT status FROM projects WHERE id=?').get(pid) as any).status).toBe('archived');
    expect(await setProjectArchived(pid, OWNER, false)).toBe(true);
    expect((db.prepare('SELECT status FROM projects WHERE id=?').get(pid) as any).status).toBe('completed');
    await deleteProjectCascade(pid);
  });
});

describe('v11.2.0 · deleteAsset + 属主校验链', () => {
  it('资产删除 + getOwnedProject 守卫', async () => {
    const pid = 'p-asset-del';
    await insertProjectFull({ id: pid, userId: OWNER, title: 'ad', description: '', coverUrls: [], status: 'completed', primaryCharacterRef: null, lockedCharacters: [] });
    const a = await createAsset({ projectId: pid, type: 'storyboard', name: 'x', data: {}, mediaUrls: ['/x.png'], shotNumber: 1 });

    // 属主校验:资产 → 项目 → 用户
    const asset = await getAsset(a.id);
    expect(asset).toBeTruthy();
    expect(await getOwnedProject(asset!.project_id, OTHER)).toBeNull();   // 他人无权
    expect(await getOwnedProject(asset!.project_id, OWNER)).toBeTruthy();

    expect(await deleteAsset(a.id)).toBe(true);
    expect(await getAsset(a.id)).toBeNull();
    await deleteProjectCascade(pid);
  });
});
