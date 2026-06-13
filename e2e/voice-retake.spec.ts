import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.6.4 — 配音 retake 工作流验收(《雨夜信号》演示工程,MOCK_ENGINES=1):
 * 单句换情绪重录 ×2 → 产物 URL 不同(A/B 可分)→ 采用 → 活动行换入 + 该镜
 * video 置 stale、其余镜零接触 → 批量重录走 pipeline_jobs 队列(type='voice-retake')。
 */

function mint() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  return jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' });
}

test('retake:单句换情绪 → A/B 不同 → 采用只动该镜 → 批量走重录队列', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  test.setTimeout(120_000);
  const token = mint();
  const auth = { Authorization: `Bearer ${token}` };
  const jsonAuth = { ...auth, 'Content-Type': 'application/json' };
  const pid = 'qfmj-demo-showcase';

  // 还原演示工程(幂等,stale 归零)
  await request.post('/api/demo-project', { headers: auth });

  // 对白镜清单(demo 4 镜全有对白;script 走 projects.script_data 回退)
  const got = await request.get(`/api/projects/${pid}/voice-retake`);
  expect(got.status()).toBe(200);
  const state0 = await got.json();
  expect(state0.count).toBeGreaterThanOrEqual(4);
  expect(state0.shots[0].speaker).toBe('程一帆');

  // 单句重录 ×2(不同情绪)→ 产物 URL 不同
  const r1 = await request.post(`/api/projects/${pid}/voice-retake`, {
    headers: jsonAuth, data: { shotNumber: 1, emotion: '愤怒' },
  });
  expect(r1.status()).toBe(200);
  const t1 = await r1.json();
  expect(t1.ok).toBe(true);

  const r2 = await request.post(`/api/projects/${pid}/voice-retake`, {
    headers: jsonAuth, data: { shotNumber: 1, emotion: '悲伤' },
  });
  const t2 = await r2.json();
  expect(t2.ok).toBe(true);
  expect(t2.audioUrl).not.toBe(t1.audioUrl); // 情绪→prosody→产物可分,A/B 有意义

  // 采用悲伤版 → 活动行换入 + 该镜 video 置 stale,其余镜零接触
  const put = await request.put(`/api/projects/${pid}/voice-retake`, {
    headers: jsonAuth, data: { takeId: t2.takeId },
  });
  expect(put.status()).toBe(200);
  const adopted = await put.json();
  expect(adopted.shotNumber).toBe(1);
  expect(adopted.staleMarked).toBeGreaterThanOrEqual(1);

  const state1 = await (await request.get(`/api/projects/${pid}/voice-retake`)).json();
  const s1 = state1.shots.find((s: any) => s.shotNumber === 1);
  expect(s1.activeUrl).toBe(t2.audioUrl);
  expect(s1.activeEmotion).toBe('悲伤');
  expect(s1.takes.find((t: any) => t.id === t2.takeId).adopted).toBe(true);

  const db = new Database('data/qfmj.db', { readonly: true });
  const rows = db.prepare("SELECT shot_number, stale FROM project_assets WHERE project_id = ? AND type = 'video'").all(pid) as any[];
  db.close();
  const staleByShot = Object.fromEntries(rows.map((r) => [r.shot_number, r.stale]));
  expect(staleByShot[1]).toBe(1); // 该镜待重渲
  expect(staleByShot[2]).toBe(0); // 其余零接触
  expect(staleByShot[3]).toBe(0);

  // 队列排空等待:满负载下复刻整片 job 会占满双槽 ~2min,先等空闲槽位再提交(独立预算)
  async function drainWait() {
    for (let i = 0; i < 100; i++) {
      const res = await request.get('/api/pipeline-jobs', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok()) return;
      const jobs = (await res.json()).jobs as Array<{ state: string }>;
      const running = jobs.filter((j) => j.state === 'running').length;
      const queued = jobs.filter((j) => j.state === 'queued').length;
      if (running < 2 && queued === 0) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  await drainWait();
  // 批量重录 → 重录队列(dev server 带 PIPELINE_QUEUE=1)
  const batch = await request.post(`/api/projects/${pid}/voice-retake`, {
    headers: jsonAuth, data: { shots: [{ shotNumber: 2, emotion: '紧张' }, { shotNumber: 3, emotion: '恐惧' }] },
  });
  const bq = await batch.json();
  expect(bq.queued).toBe(true);
  expect(bq.jobId).toMatch(/^pj_/);

  // 等队列消化(mock TTS 秒级;tick 1.5s)
  let jobState = '';
  for (let i = 0; i < 90; i++) {
    const jr = await (await request.get('/api/pipeline-jobs', { headers: auth })).json();
    jobState = jr.jobs.find((j: any) => j.id === bq.jobId)?.state || '';
    if (jobState === 'done' || jobState === 'failed') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  expect(jobState).toBe('done');

  const state2 = await (await request.get(`/api/projects/${pid}/voice-retake`)).json();
  for (const n of [2, 3]) {
    const s = state2.shots.find((x: any) => x.shotNumber === n);
    expect(s.takes.length, `镜 ${n} 应有重录版`).toBeGreaterThanOrEqual(1);
  }
});
