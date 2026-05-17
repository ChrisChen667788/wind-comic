/**
 * v3.1 F — Cinema timeline API (shot reorder + duration update).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import { GET, POST } from '@/app/api/projects/[id]/timeline/route';

function mkReq(method: string, body?: any): any {
  const url = new URL('http://localhost/api/projects/x/timeline');
  return {
    nextUrl: url,
    headers: { get: () => null },
    json: async () => body || {},
  };
}

let SEEDED_USER_ID = '';

beforeEach(() => {
  if (!SEEDED_USER_ID) {
    const u = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    SEEDED_USER_ID = u?.id || '';
  }
  db.prepare("DELETE FROM project_assets WHERE project_id LIKE 'test-tl-%'").run();
  db.prepare("DELETE FROM projects WHERE id LIKE 'test-tl-%'").run();
});

function seedScript(projectId: string, shots: Array<{ shotNumber: number; duration: number; dialogue?: string }>) {
  // project_assets FK → projects(id); 必须先建 project
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, user_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(projectId, SEEDED_USER_ID, 'test-tl-project', now(), now());
  const data = {
    title: 'test',
    synopsis: 's',
    shots: shots.map((s) => ({
      shotNumber: s.shotNumber, duration: s.duration, dialogue: s.dialogue || '',
      sceneDescription: '', action: '', emotion: '', characters: [],
    })),
  };
  db.prepare(
    `INSERT INTO project_assets (id, project_id, type, name, media_urls, data, created_at, updated_at)
     VALUES (?, ?, 'script', 'test', '[]', ?, ?, ?)`,
  ).run(nanoid(), projectId, JSON.stringify(data), now(), now());
}

describe('v3.1 F · GET /timeline', () => {
  it('returns empty when no script', async () => {
    const res = await GET(mkReq('GET'), { params: Promise.resolve({ id: 'test-tl-empty' }) });
    const body = await res.json();
    expect(body.shots).toEqual([]);
  });

  it('returns shots + totalDuration from script asset', async () => {
    const pid = `test-tl-${nanoid(6)}`;
    seedScript(pid, [
      { shotNumber: 1, duration: 5, dialogue: 'A' },
      { shotNumber: 2, duration: 10, dialogue: 'B' },
    ]);
    const res = await GET(mkReq('GET'), { params: Promise.resolve({ id: pid }) });
    const body = await res.json();
    expect(body.shots.length).toBe(2);
    expect(body.totalDuration).toBe(15);
    expect(body.shots[0].dialogue).toBe('A');
  });
});

describe('v3.1 F · POST /timeline (reorder + duration)', () => {
  it('reorders shots and reassigns shotNumber 1..N', async () => {
    const pid = `test-tl-${nanoid(6)}`;
    seedScript(pid, [
      { shotNumber: 1, duration: 5, dialogue: 'A' },
      { shotNumber: 2, duration: 5, dialogue: 'B' },
      { shotNumber: 3, duration: 5, dialogue: 'C' },
    ]);
    // 把 shot 3 移到首位 (新顺序: 3, 1, 2)
    const res = await POST(
      mkReq('POST', { shotOrder: [3, 1, 2] }),
      { params: Promise.resolve({ id: pid }) },
    );
    const body = await res.json();
    expect(body.shots.length).toBe(3);
    // shotNumber 重分配后, position 0 (原来的 shot 3) 现在 shotNumber=1, dialogue='C'
    expect(body.shots[0].shotNumber).toBe(1);
    // 验内容: 拉回 GET 看 dialogue
    const get = await GET(mkReq('GET'), { params: Promise.resolve({ id: pid }) });
    const getBody = await get.json();
    expect(getBody.shots[0].dialogue).toBe('C');
    expect(getBody.shots[1].dialogue).toBe('A');
    expect(getBody.shots[2].dialogue).toBe('B');
  });

  it('updates per-shot duration', async () => {
    const pid = `test-tl-${nanoid(6)}`;
    seedScript(pid, [
      { shotNumber: 1, duration: 5 },
      { shotNumber: 2, duration: 5 },
    ]);
    const res = await POST(
      mkReq('POST', { durations: { '1': 10, '2': 15 } }),
      { params: Promise.resolve({ id: pid }) },
    );
    const body = await res.json();
    expect(body.totalDuration).toBe(25);
  });

  it('clamps duration to (0, 60]', async () => {
    const pid = `test-tl-${nanoid(6)}`;
    seedScript(pid, [{ shotNumber: 1, duration: 5 }]);
    await POST(
      mkReq('POST', { durations: { '1': 999 } }),
      { params: Promise.resolve({ id: pid }) },
    );
    const get = await GET(mkReq('GET'), { params: Promise.resolve({ id: pid }) });
    const body = await get.json();
    // 应被拒绝 (>60 不接受), 保留原 5
    expect(body.shots[0].duration).toBe(5);
  });

  it('returns 404 when no script', async () => {
    const res = await POST(
      mkReq('POST', { shotOrder: [1] }),
      { params: Promise.resolve({ id: 'test-tl-noscript' }) },
    );
    expect(res.status).toBe(404);
  });
});
