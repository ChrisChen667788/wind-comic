import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v11.1.0 — 拉片表验收(《雨夜信号》演示工程):
 * GET 五栏真值(出厂参数,demo 已含 v2.8 摄影字段)+ 时间轴累计 + CSV 导出。
 */

function mint() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  return jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' });
}

test('拉片表:五栏出厂真值 + 时间轴 + CSV 导出', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const auth = { Authorization: `Bearer ${mint()}` };
  const pid = 'qfmj-demo-showcase';

  await request.post('/api/demo-project', { headers: auth }); // 幂等还原(带 v2.8 摄影字段)

  const res = await request.get(`/api/projects/${pid}/pull-sheet`);
  expect(res.status()).toBe(200);
  const sheet = await res.json();
  expect(sheet.shotCount).toBe(4);
  expect(sheet.totalDurationSec).toBe(20);
  expect(sheet.source).toBe('factory');

  const s1 = sheet.shots[0];
  // 叙事要素
  expect(s1.scene).toBe('霓虹雨巷');
  expect(s1.characters).toEqual(['程一帆']);
  expect(s1.dialogue).toContain('23:17');
  // 时间
  expect(s1.startSec).toBe(0);
  expect(s1.endSec).toBe(5);
  // 镜头语言 / 影像处理 / 声音 / 叙事功能(出厂真值,非猜测)
  expect(s1.shotSize).toBe('全景');
  expect(s1.cameraMovement).toContain('dolly-in');
  expect(s1.lightingIntent).toContain('霓虹');
  expect(s1.scoreMood).toBeTruthy();
  expect(s1.storyBeat).toContain('钩子');
  // 媒体挂接(demo 自带分镜图/视频资产)
  expect(s1.thumbnail).toBeTruthy();
  expect(s1.videoUrl).toBeTruthy();
  // 末镜时间轴
  expect(sheet.shots[3].endSec).toBe(20);
  expect(sheet.shots[3].storyBeat).toContain('高潮');

  // CSV 导出
  const csv = await request.get(`/api/projects/${pid}/pull-sheet?format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body).toContain('镜头语言 · 景别');
  expect(body).toContain('霓虹雨巷');
  expect(body.split('\r\n').length).toBe(5); // 表头 + 4 镜
});

test('外部参考片拆条:URL → 队列 → 骨架表落库(MOCK 模式零外部调用)', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  test.setTimeout(120_000);
  const token = mint();
  const jsonAuth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const pid = 'qfmj-demo-showcase';
  await request.post('/api/demo-project', { headers: { Authorization: `Bearer ${token}` } });

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
  // 用仓库自带真 mp4 作参考片(dev server 可达)
  const post = await request.post(`/api/projects/${pid}/pull-sheet`, {
    headers: jsonAuth,
    data: { videoUrl: 'http://localhost:3000/cases/clip-a.mp4', name: 'e2e 参考片' },
  });
  expect(post.status()).toBe(200);
  const bq = await post.json();
  expect(bq.queued).toBe(true); // dev server 带 PIPELINE_QUEUE=1

  // 等队列消化(ffmpeg 切分 + 抽帧,短片秒级)
  let jobState = '';
  for (let i = 0; i < 90; i++) {
    const jr = await (await request.get('/api/pipeline-jobs', { headers: { Authorization: `Bearer ${token}` } })).json();
    jobState = jr.jobs.find((j: any) => j.id === bq.jobId)?.state || '';
    if (jobState === 'done' || jobState === 'failed') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  expect(jobState).toBe('done');

  const ext = await (await request.get(`/api/projects/${pid}/pull-sheet?external=1`)).json();
  expect(ext.count).toBeGreaterThanOrEqual(1);
  const sheet = ext.sheets[0].sheet; // 新→旧排序,取最新
  expect(sheet.source).toBe('skeleton');       // MOCK_ENGINES=1 → Vision 跳过,诚实骨架
  expect(sheet.shotCount).toBeGreaterThanOrEqual(1);
  expect(sheet.totalDurationSec).toBeGreaterThan(0);
  const s1 = sheet.shots[0];
  expect(s1.startSec).toBe(0);
  expect(s1.durationSec).toBeGreaterThan(0);
  expect(s1.thumbnail).toBeTruthy();           // 中帧已入库存储
  expect(s1.shotSize).toBe('');                // 骨架不编造镜头语言
});
