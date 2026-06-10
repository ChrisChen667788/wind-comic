/**
 * v10.4.2 — upsertAsset 幂等写单测(SQLite driver,真 DB)。
 * 覆盖:按 name / 按 shotNumber 两种选择器、二次写不增行、空 mediaUrls 不抹好 URL、历史重复行自愈。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { upsertAsset, listAssetsByType, createAsset } from '@/lib/repos/asset-repo';

let projectId: string;
beforeAll(() => {
  const uid = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(uid, `${uid}@test.local`, 'x', uid, now());
  projectId = 'proj-' + nanoid();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, '', '[]', 'draft', ?, ?)`)
    .run(projectId, uid, 'upsert-test', now(), now());
});

describe('v10.4.2 · upsertAsset 幂等写', () => {
  it('按 name:首写 created,二写 updated 且不增行、data 刷新', async () => {
    expect(await upsertAsset({ projectId, type: 'script', name: '剧本', data: { v: 1 } })).toBe('created');
    expect(await upsertAsset({ projectId, type: 'script', name: '剧本', data: { v: 2 } })).toBe('updated');
    const rows = await listAssetsByType(projectId, 'script');
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].data).v).toBe(2);
  });

  it('按 shotNumber:同镜头重写不增行(规划→渲染两次落库收敛为一行)', async () => {
    await upsertAsset({ projectId, type: 'storyboard', name: '镜头 1', data: { description: '规划' }, shotNumber: 1 });
    await upsertAsset({ projectId, type: 'storyboard', name: '镜头 1', data: { description: '渲染', cameoScore: 0.9 }, mediaUrls: ['http://x/a.svg'], shotNumber: 1 });
    await upsertAsset({ projectId, type: 'storyboard', name: '镜头 2', data: { description: '规划' }, shotNumber: 2 });
    const rows = await listAssetsByType(projectId, 'storyboard');
    expect(rows.length).toBe(2);
    const shot1 = rows.find((r) => r.shot_number === 1)!;
    expect(JSON.parse(shot1.data).cameoScore).toBe(0.9);
    expect(JSON.parse(shot1.media_urls!)).toEqual(['http://x/a.svg']);
  });

  it('空 mediaUrls 不抹掉已有好 URL(渲染失败兜底语义)', async () => {
    await upsertAsset({ projectId, type: 'video', name: '视频 1', data: { d: 1 }, mediaUrls: ['http://x/v1.mp4'], shotNumber: 1 });
    await upsertAsset({ projectId, type: 'video', name: '视频 1', data: { d: 2 }, mediaUrls: [], shotNumber: 1 });
    const rows = await listAssetsByType(projectId, 'video');
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].media_urls!)).toEqual(['http://x/v1.mp4']); // URL 保留
    expect(JSON.parse(rows[0].data).d).toBe(2); // data 仍刷新
  });

  it('历史重复行(v10.4.1 时期)被一并刷成同值 = 自愈而非再添乱', async () => {
    // 直接造两行同 (type,name) 的历史重复
    await createAsset({ projectId, type: 'plan', name: '导演计划', data: { old: 1 } });
    await createAsset({ projectId, type: 'plan', name: '导演计划', data: { old: 2 } });
    expect(await upsertAsset({ projectId, type: 'plan', name: '导演计划', data: { fresh: true } })).toBe('updated');
    const rows = await listAssetsByType(projectId, 'plan');
    expect(rows.length).toBe(2); // 行数不再增长
    for (const r of rows) expect(JSON.parse(r.data)).toEqual({ fresh: true }); // 全部刷为同值
  });
});
