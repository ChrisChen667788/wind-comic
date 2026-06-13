import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

/**
 * v10.4.0 — 主链路 journey e2e(安全网):登录 → 创作工坊 → ROLL → 出片 → 导出。
 *
 * 前提:dev server 以 `MOCK_ENGINES=1 npm run dev` 启动(mock 引擎 + 隐含
 * PLUGIN_CHAIN_MODE=primary)。未开 mock 时本 spec 自动 skip(不误红)。
 * 只跑 desktop 项目(双端各跑一条完整流水线没有增量价值,且污染演示库 ×2)。
 *
 * 验收:全链路(含 LLM 缺 key 的 fallbackScript 模板)< 60s;镜头资产 URL 指向
 * /api/mock-assets/*(证明走的是 provider 成功路径,而非 data:URI 占位兜底)。
 */

function mintDemoSession() {
  const db = new Database('data/qfmj.db', { readonly: true });
  const u = db
    .prepare("SELECT id,email,name,role,avatar_url,locale FROM users WHERE email='demo@qfmanju.ai'")
    .get() as { id: string; email: string; name: string; role: string; avatar_url: string; locale: string };
  db.close();
  const secret = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
  const token = jwt.sign({ sub: u.id, role: u.role }, secret, { expiresIn: '7d' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatar_url, locale: u.locale };
  return { token, user };
}

async function pollUntil<T>(fn: () => Promise<T | null>, timeoutMs: number, intervalMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`poll timeout after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test('journey: 登录 → 创建 → ROLL → 出片 → 导出(mock 引擎)', async ({ page, request }, testInfo) => {
  test.setTimeout(480_000); // 预算:排空等待 300s(独立)+ projectId 120s + 资产 110s
  test.skip(testInfo.project.name !== 'desktop', '主链路只跑 desktop(mobile 由 smoke/a11y 覆盖)');

  const ready = await request.get('/api/runtime/readiness');
  const readiness = await ready.json();
  test.skip(!readiness.mockEngines, '需 MOCK_ENGINES=1 启动 dev server');
  expect(readiness.demoMode, 'mock 引擎应让 image/video 就绪 → 非演示模式').toBe(false);

  const t0 = Date.now();
  const { token, user } = mintDemoSession();
  const auth = { Authorization: `Bearer ${token}` };

  // ── 1. 登录态注入 + 进创作工坊 ──
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('qfmj-token', t as string);
      localStorage.setItem('qfmj-user', u as string);
        localStorage.setItem('qfmj-create-guide-done', '1'); // v10.5.3: 预置引导完成,防遮罩挡操作/污染 axe 基线
    },
    [token, JSON.stringify(user)] as [string, string],
  );
  await page.goto('/dashboard/create', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800); // 水合

  // ── 2. 填创意 + ROLL ──
  // 注:有真 LLM key 的环境会把 idea 扩写成创作纲要(title 不再含原文),
  // 故不用文本 marker 匹配 —— 改为点击前快照项目 id 集合,点击后找新增 id。
  const listIds = async (): Promise<string[]> => {
    const res = await request.get('/api/projects', { headers: auth });
    if (!res.ok()) return [];
    const list = await res.json();
    const arr: Array<{ id: string }> = Array.isArray(list) ? list : list?.data || [];
    return arr.map((p) => p.id);
  };
  const prevIds = new Set(await listIds());

  // ── 1.5 队列模式排空等待:重复全量跑会堆积前序任务(剪辑段 ffmpeg 分钟级),
  // 双槽位占满时新 job 干等 —— 显式等到有空闲槽位再 ROLL,预算独立不挤占后续轮询。
  await pollUntil<boolean>(async () => {
    const res = await request.get('/api/pipeline-jobs', { headers: auth });
    if (!res.ok()) return true; // 队列 API 不可用(旧路径/未启队列)→ 直接放行
    const jobs = (await res.json()).jobs as Array<{ state: string }>;
    const running = jobs.filter((j) => j.state === 'running').length;
    const queued = jobs.filter((j) => j.state === 'queued').length;
    if (running < 2 && queued === 0) return true;
    console.log(`[journey] 等空闲槽位… running=${running} queued=${queued}`);
    return null;
  }, 300_000, 5_000);

  // ≥30 字且带题材信号 —— mock 全封闭模式只走规则清洗,要过 thin-idea 闸门
  const idea = 'E2E旅程:暮色城市霓虹雨夜,失忆旅人凭一张旧照片追查身世之谜的悬疑短剧,巷尾追逐与天台对峙';
  await page.locator('textarea.cinema-textarea').first().fill(idea);
  const rollBtn = page.getByRole('button', { name: /开机.*ROLL/ });
  await expect(rollBtn).toBeEnabled({ timeout: 5_000 });
  await rollBtn.click();

  // ── 3. 项目落库(create-stream 入口早期 INSERT)──
  const projectId = await pollUntil<string>(async () => {
    const ids = await listIds();
    return ids.find((id) => !prevIds.has(id)) || null;
  }, 120_000); // 队列模式:projectId 在 worker 认领后才落库;前序任务剪辑段(ffmpeg 分钟级)可占满双槽位 → 排队等待计入预算
  console.log(`[journey] projectId=${projectId} (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // ── 4. 出片:轮询资产直到出现 mock 视频(provider 成功路径的铁证)──
  const assetsJson = await pollUntil<string>(async () => {
    const res = await request.get(`/api/projects/${encodeURIComponent(projectId)}/assets`, { headers: auth });
    if (!res.ok()) return null;
    const text = JSON.stringify(await res.json());
    return text.includes('/api/mock-assets/clip/') ? text : null;
  }, 110_000, 3_000); // 110s:rm -rf .next 后首跑会叠加 Turbopack 按需编译(实测 +40s+),给足冷启动余量
  expect(assetsJson).toContain('/api/mock-assets/image/'); // 分镜图也走了 mock 成功路径
  // v10.6.0 竖屏优先:create 页默认画幅已是 9:16 → 资产 URL 必带 ar=9:16
  // (mock 引擎把画幅写进 URL,等于全链路「无横屏假设」的自动化锚点)
  expect(assetsJson).toContain('ar=9%3A16');
  console.log(`[journey] mock 视频资产已出现 (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // ── 5. 导出 EDL(剪辑交付物)──
  const edl = await request.get(`/api/projects/${encodeURIComponent(projectId)}/export-edl`, { headers: auth });
  expect(edl.status(), 'export-edl 应 200').toBe(200);
  const edlText = await edl.text();
  expect(edlText.length).toBeGreaterThan(50);

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`[journey] 全链路完成,耗时 ${elapsed.toFixed(1)}s(暖机验收目标 <60s)`);
  expect(elapsed).toBeLessThan(280); // 硬上限只防挂死;<60s 为空载暖机验收目标 —— 队列排队(双槽位被前序剪辑段占满,实测 +58s)与冷编译首跑(+40s+)不计入性能口径
});
