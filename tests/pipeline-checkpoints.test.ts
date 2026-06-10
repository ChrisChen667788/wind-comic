/**
 * v10.4.2 — 断点装载单测(SQLite driver,真 DB)。
 * 覆盖:各阶段形状还原、persistent_url 优先、分镜「已渲染/仅规划」切分、
 * 空壳剧本不算断点、重复行取最新、director_notes → review、摘要文案。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { createAsset } from '@/lib/repos/asset-repo';
import { loadCheckpoints, emptyCheckpoints, checkpointSummary } from '@/lib/pipeline-checkpoints';

let projectId: string;
let emptyProjectId: string;

beforeAll(async () => {
  const uid = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(uid, `${uid}@test.local`, 'x', uid, now());
  projectId = 'proj-' + nanoid();
  emptyProjectId = 'proj-' + nanoid();
  for (const pid of [projectId, emptyProjectId]) {
    db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, '', '[]', 'draft', ?, ?)`)
      .run(pid, uid, 'cp-test', now(), now());
  }
  db.prepare(`UPDATE projects SET director_notes = ? WHERE id = ?`).run(JSON.stringify({ passed: true, score: 88 }), projectId);

  await createAsset({ projectId, type: 'plan', name: '导演计划', data: { characters: [{ name: '主角' }], scenes: [{ name: '主场景' }] } });
  await createAsset({ projectId, type: 'script', name: '剧本', data: { title: 'T', synopsis: 'S', shots: [{ shotNumber: 1 }, { shotNumber: 2 }], theme: 'noir' } });
  await createAsset({ projectId, type: 'styleBible', name: 'Style Bible Key Art', data: { url: 'http://x/bible.svg' }, mediaUrls: ['http://x/bible.svg'] });
  await createAsset({ projectId, type: 'character', name: '主角', data: { description: 'D', appearance: 'A' }, mediaUrls: ['http://x/c1.svg'] });
  await createAsset({ projectId, type: 'scene', name: '主场景', data: { description: 'SD' }, mediaUrls: ['http://x/s1.svg'] });
  // 镜头 1 已渲染(且有 persistent 副本 → 应优先);镜头 2 仅规划(无图)
  await createAsset({ projectId, type: 'storyboard', name: '镜头 1', data: { description: 'P1', duration: 10 }, mediaUrls: ['http://x/sb1.svg'], persistentUrl: '/api/serve-file?key=sb1', shotNumber: 1 });
  await createAsset({ projectId, type: 'storyboard', name: '镜头 2', data: { description: 'P2', duration: 10 }, shotNumber: 2 });
  // 镜头 1 已出片;镜头 2 没有
  await createAsset({ projectId, type: 'video', name: '视频 1', data: { duration: 4, status: 'completed' }, mediaUrls: ['http://x/v1.mp4'], shotNumber: 1 });
  await createAsset({ projectId, type: 'final_video', name: '最终成片', data: { duration: 8 }, mediaUrls: ['http://x/final.mp4'] });
  await createAsset({ projectId, type: 'timeline', name: '剪辑时间线', data: { totalDuration: 8, finalVideoUrl: 'http://x/final.mp4' } });
});

describe('v10.4.2 · loadCheckpoints', () => {
  it('空项目 → 等价 emptyCheckpoints,摘要为「无」', async () => {
    const cp = await loadCheckpoints(emptyProjectId);
    expect(cp).toEqual(emptyCheckpoints());
    expect(checkpointSummary(cp)).toBe('无');
  });

  it('全量还原:plan/script/角色/场景/分镜切分/视频/成片/审核', async () => {
    const cp = await loadCheckpoints(projectId);
    expect(cp.plan?.characters?.[0]?.name).toBe('主角');
    expect(cp.script?.shots?.length).toBe(2);
    expect(cp.styleBibleUrl).toBe('http://x/bible.svg');
    expect(cp.characters).toEqual([
      { name: '主角', character: '主角', description: 'D', appearance: 'A', imageUrl: 'http://x/c1.svg' },
    ]);
    expect(cp.scenes[0]).toMatchObject({ name: '主场景', description: 'SD' });
    // 分镜:规划 2 条,已渲染 1 条;persistent_url 优先于 media_urls
    expect(cp.storyboardPlans.length).toBe(2);
    expect(cp.storyboards.length).toBe(1);
    expect(cp.storyboards[0].shotNumber).toBe(1);
    expect(cp.storyboards[0].imageUrl).toBe('/api/serve-file?key=sb1');
    // 视频:只有镜头 1
    expect(cp.videos).toEqual([
      { shotNumber: 1, videoUrl: 'http://x/v1.mp4', duration: 4, status: 'completed', coverImageUrl: null },
    ]);
    expect(cp.hasFinalVideo).toBe(true);
    expect(cp.editResult?.finalVideoUrl).toBe('http://x/final.mp4');
    expect(cp.review).toEqual({ passed: true, score: 88 });
    expect(checkpointSummary(cp)).toContain('剧本');
    expect(checkpointSummary(cp)).toContain('成片');
  });

  it('空壳剧本(无 shots)不算断点', async () => {
    const pid = 'proj-' + nanoid();
    const uid2 = 'u-' + nanoid();
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(uid2, `${uid2}@test.local`, 'x', uid2, now());
    db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, '', '[]', 'draft', ?, ?)`)
      .run(pid, uid2, 'empty-script', now(), now());
    await createAsset({ projectId: pid, type: 'script', name: '剧本', data: { title: 'T', shots: [] } });
    const cp = await loadCheckpoints(pid);
    expect(cp.script).toBeNull();
  });
});
