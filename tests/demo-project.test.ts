/**
 * v10.5.0 — 演示工程导入单测(SQLite driver,真 DB)。
 * 覆盖:全套资产落库、重复导入幂等(零翻倍 + refreshed 标记)、项目字段完整。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { importDemoProject, DEMO_PROJECT_ID } from '@/lib/demo-project';

let userId: string;
beforeAll(() => {
  // 清掉可能存在的演示工程(其他测试/手测残留)
  db.prepare('DELETE FROM project_assets WHERE project_id = ?').run(DEMO_PROJECT_ID);
  db.prepare('DELETE FROM project_quality_scores WHERE project_id = ?').run(DEMO_PROJECT_ID);
  db.prepare('DELETE FROM projects WHERE id = ?').run(DEMO_PROJECT_ID);
  userId = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(userId, `${userId}@test.local`, 'x', userId, now());
});

function assetCounts(): Record<string, number> {
  const rows = db.prepare('SELECT type, count(*) c FROM project_assets WHERE project_id = ? GROUP BY type').all(DEMO_PROJECT_ID) as Array<{ type: string; c: number }>;
  return Object.fromEntries(rows.map((r) => [r.type, r.c]));
}

const EXPECT = {
  plan: 1, script: 1, styleBible: 1, character: 2, scene: 2,
  storyboard: 4, video: 4, final_video: 1, timeline: 1,
};

describe('v10.5.0 · importDemoProject', () => {
  it('首次导入:项目 completed + 全套资产 + 审核/质量数据', async () => {
    const r = await importDemoProject(userId);
    expect(r.projectId).toBe(DEMO_PROJECT_ID);
    expect(r.refreshed).toBe(false);

    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(DEMO_PROJECT_ID) as any;
    expect(proj.status).toBe('completed');
    expect(JSON.parse(proj.script_data).shots.length).toBe(4);
    expect(JSON.parse(proj.director_notes).passed).toBe(true);
    expect(JSON.parse(proj.cover_urls)[0]).toMatch(/^\/styles\//);

    expect(assetCounts()).toEqual(EXPECT);

    // 镜头视频指向仓库内置片段(0 外部依赖)
    const v1 = db.prepare("SELECT media_urls FROM project_assets WHERE project_id = ? AND type = 'video' AND shot_number = 1").get(DEMO_PROJECT_ID) as any;
    expect(JSON.parse(v1.media_urls)).toEqual(['/cases/clip-a.mp4']);

    const q = db.prepare('SELECT count(*) c FROM project_quality_scores WHERE project_id = ?').get(DEMO_PROJECT_ID) as any;
    expect(q.c).toBe(1);
  });

  it('重复导入:幂等刷新 —— 资产零翻倍 + refreshed=true', async () => {
    // 模拟用户改坏了演示数据
    db.prepare("UPDATE projects SET status = 'draft' WHERE id = ?").run(DEMO_PROJECT_ID);
    const r = await importDemoProject(userId);
    expect(r.refreshed).toBe(true);
    expect(assetCounts()).toEqual(EXPECT); // 不翻倍
    const proj = db.prepare('SELECT status FROM projects WHERE id = ?').get(DEMO_PROJECT_ID) as any;
    expect(proj.status).toBe('completed'); // 还原出厂
  });
});
