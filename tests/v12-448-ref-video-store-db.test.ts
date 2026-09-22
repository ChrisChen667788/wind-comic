/**
 * v12.448 · 参考视频存储层对**真数据库**往返(测试进程的临时 SQLite)。
 *
 * 路由测试把存储层整个换成了假的,事务里先查后写、删除语句、同镜并发保存这些 SQL 一次都没真跑过 ——
 * 浏览器真机又因预览环境的问题碰不到这条路由,所以在这里补上。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import {
  saveShotRefVideo, getShotRefVideo, listShotRefVideos, deleteShotRefVideo, refVideoOptsForShot, SHOT_REF_VIDEO_TYPE,
} from '@/lib/shot-ref-video-store';

let pid = '';
let other = '';
beforeAll(async () => {
  const uid = 'u-' + nanoid(8);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(uid, `${uid}@t.local`, 'x', 'tester', now());
  pid = (await createProject({ userId: uid, title: '参考视频', description: 'd', coverUrls: [] }) as any).id;
  other = (await createProject({ userId: uid, title: '别的项目', description: 'd', coverUrls: [] }) as any).id;
});

const rowsOf = (projectId: string) =>
  db.prepare(`SELECT shot_number, data FROM project_assets WHERE project_id = ? AND type = ?`).all(projectId, SHOT_REF_VIDEO_TYPE) as any[];

describe('v12.448 · 参考视频存储(真库)', () => {
  it('同一镜保存两次是更新,不是多出一行;字段按原样回来', async () => {
    await saveShotRefVideo(pid, { shotNumber: 2, url: 'https://cdn.example/a.mp4', source: 'link' });
    await saveShotRefVideo(pid, { shotNumber: 2, url: '/api/serve-file?key=k', source: 'upload', durationSec: 15, trimmedFrom: 20, width: 640, height: 360, sizeBytes: 1234 });
    expect(rowsOf(pid)).toHaveLength(1);
    const got = await getShotRefVideo(pid, 2);
    expect(got).toMatchObject({ shotNumber: 2, url: '/api/serve-file?key=k', source: 'upload', durationSec: 15, trimmedFrom: 20, width: 640, height: 360, sizeBytes: 1234 });
    expect(typeof got!.updatedAt).toBe('string');
  });

  it('列表按镜号排序,只含本项目', async () => {
    await saveShotRefVideo(pid, { shotNumber: 1, url: 'https://cdn.example/b.mp4', source: 'link' });
    await saveShotRefVideo(other, { shotNumber: 1, url: 'https://cdn.example/other.mp4', source: 'link' });
    expect((await listShotRefVideos(pid)).map((r) => r.shotNumber)).toEqual([1, 2]);
    expect((await listShotRefVideos(other)).map((r) => r.url)).toEqual(['https://cdn.example/other.mp4']);
  });

  it('删除只删本项目该镜;删不存在的返回 false', async () => {
    expect(await deleteShotRefVideo(pid, 1)).toBe(true);
    expect(await getShotRefVideo(pid, 1)).toBeNull();
    expect(await getShotRefVideo(other, 1)).not.toBeNull();
    expect(await deleteShotRefVideo(pid, 99)).toBe(false);
  });

  it('出片注入口从真库取到链接,交出引擎地址', async () => {
    await saveShotRefVideo(pid, { shotNumber: 7, url: 'https://cdn.example/move.mp4', source: 'link' });
    const r = await refVideoOptsForShot(pid, 7, () => {});
    expect(r.referenceVideoUrl).toBe('https://cdn.example/move.mp4');
    expect(await refVideoOptsForShot(pid, 8, () => {})).toEqual({});
  });
});
