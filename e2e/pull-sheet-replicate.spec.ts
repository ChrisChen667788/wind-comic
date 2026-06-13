import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v11.1.2 — 拉片复刻验收(《雨夜信号》「全员换猫」):
 * 预览改写 prompt → 复刻起片 → 新项目保原片镜头结构/时长(MOCK 引擎并行生成)。
 */
function mint() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db.prepare("SELECT id, role FROM users WHERE email='demo@qfmanju.ai'").get() as any;
  db.close();
  return { token: jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod', { expiresIn: '1h' }), uid: u.id };
}

test('复刻:全员换猫 → 预览改写 → 起片 → 新项目保结构', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  test.setTimeout(600_000);
  const { token } = mint();
  const jsonAuth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const pid = 'qfmj-demo-showcase';
  await request.post('/api/demo-project', { headers: { Authorization: `Bearer ${token}` } });

  const replacements = [
    { kind: 'character', to: '一只橘猫' },                  // 整列角色全换猫
    { kind: 'global', from: '程一帆', to: '橘猫' },
    { kind: 'global', from: '苏雨眠', to: '奶牛猫' },
  ];

  // 预览:改写后逐镜 prompt(不建项目)
  const prev = await request.post(`/api/projects/${pid}/pull-sheet/replicate`, {
    headers: jsonAuth, data: { sheetSource: 'factory', replacements, preview: true },
  });
  expect(prev.status()).toBe(200);
  const pv = await prev.json();
  expect(pv.shotCount).toBe(4);
  expect(pv.shots[0].characters).toContain('一只橘猫');       // 角色已换
  expect(pv.shots[0].durationSec).toBe(5);                    // 时长锁定
  expect(pv.shots[0].prompt).toContain('镜头:');             // 镜头语言入 prompt
  // v11.1.3 复刻保真度对照(换名保留冲突词 → 高保真)
  expect(pv.fidelity).toBeTruthy();
  expect(pv.fidelity.fidelity.overall).toBeGreaterThanOrEqual(0);
  expect(pv.fidelity.fidelity.overall).toBeLessThanOrEqual(100);
  expect(pv.fidelity.original.openingHook).toBeGreaterThanOrEqual(0);

  // 队列排空等待:满负载下另一条整片 e2e(journey)会占满双槽,先等空闲槽位再起片(独立预算)
  async function drainWait() {
    for (let i = 0; i < 120; i++) {
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

  // 复刻起片(改一条 prompt 验证 editedPrompts)
  const go = await request.post(`/api/projects/${pid}/pull-sheet/replicate`, {
    headers: jsonAuth,
    data: { sheetSource: 'factory', replacements, title: 'e2e 换猫版', editedPrompts: { 1: '橘猫怒砸电脑,全景' } },
  });
  expect(go.status()).toBe(200);
  const gj = await go.json();
  expect(gj.newProjectId).toBeTruthy();
  expect(gj.shots).toBe(4);
  expect(gj.queued).toBe(true); // dev server PIPELINE_QUEUE=1

  // 新项目脚本应立即落库(replicaScript 跳过 Writer,镜头结构/时长照原片)
  let scriptOk = false;
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`/api/projects/${gj.newProjectId}/pull-sheet`);
    if (res.ok()) {
      const sheet = await res.json();
      if (sheet.shotCount === 4) {
        expect(sheet.totalDurationSec).toBe(20);              // 保原片总时长
        scriptOk = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  expect(scriptOk).toBe(true);

  // 等复刻 job 跑到 done(证明 replicaScript 跳过 Writer 后全链并行生成成片;
  // 整片生成会占满 worker 槽位,用有界 job 状态轮询替代长资产轮询,减少对其他队列 e2e 的饿死)
  let jobDone = false;
  for (let i = 0; i < 150; i++) {
    const jr = await (await request.get('/api/pipeline-jobs', { headers: { Authorization: `Bearer ${token}` } })).json();
    const st = jr.jobs.find((j: any) => j.id === gj.jobId)?.state;
    if (st === 'done') { jobDone = true; break; }
    if (st === 'failed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  expect(jobDone).toBe(true);

  // 成片资产已落库(并行生成产物)
  const assets = await (await request.get(`/api/projects/${gj.newProjectId}/assets`)).json();
  expect(Array.isArray(assets) && assets.some((x: any) => x.type === 'video')).toBe(true);
});

test('存为私有模板:拉片结构沉淀 → 模板市场可见(私有)', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '桌面验收');
  const { token } = mint();
  const jsonAuth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const pid = 'qfmj-demo-showcase';
  await request.post('/api/demo-project', { headers: { Authorization: `Bearer ${token}` } });

  const res = await request.post(`/api/projects/${pid}/pull-sheet/save-template`, {
    headers: jsonAuth, data: { sheetSource: 'factory', title: 'e2e 结构模板' },
  });
  expect(res.status()).toBe(200);
  const b = await res.json();
  expect(b.ok).toBe(true);
  expect(b.templateId).toMatch(/^tpl_/);
  expect(b.visibility).toBe('private');

  // 模板落库可读(payload 带拉片结构)
  const db = new Database('data/qfmj.db', { readonly: true });
  const row = db.prepare('SELECT shot_count, visibility, payload FROM film_templates WHERE id = ?').get(b.templateId) as any;
  db.close();
  expect(row.visibility).toBe('private');
  expect(row.shot_count).toBe(4);                    // 拉片镜数沉淀
  const payload = JSON.parse(row.payload);
  expect(payload.pullSheetStructure.shotCount).toBe(4);
  expect(payload.pullSheetStructure.totalDurationSec).toBe(20);
  expect(payload.pullSheetStructure.perShot.length).toBe(4);
  expect(payload.pullSheetStructure.perShot[0].shotSize).toBe('全景'); // 逐镜镜头语言留存
});

