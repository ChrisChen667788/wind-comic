import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { openDemoDb } from './helpers/demo-db';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';

/**
 * v12.460 — 导演台 3D 视口在**真浏览器**里的两条路(jsdom 里画布尺寸为 0,r3f 根本不建渲染器,测不到)。
 *
 * 为什么要有:React 19.3 + @react-three/fiber 9.8 升级。r3f 9.8.0 把「建根 → 配渲染器」改成同步、
 * 异步渲染器改为「挂起等它」,9.8.1 又加了「根卸载时自动 dispose 渲染器」。
 * 而我们的渲染器工厂(stage3d-viewport.tsx 的 makeRendererFactory)恰好踩在这两处:
 * 失败时通知父组件切 2D,并返回一个**永不完成的 Promise**(r3f 9.7 下为了不产生未处理拒绝)。
 *   ① 成功路:画布真的画出东西(不是黑框/空白),切 2D ↔ 3D 反复卸载重建不报错;
 *   ② 失败路:WebGL 建不起来 → 退回 2D 预览并显示原因,不留黑框、不出未处理的拒绝。
 *
 * 用一次性项目(归属 demo 账号),测完删除。服务器 JWT_SECRET 须与本文件一致。
 */
const SECRET = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';

async function seed(request: APIRequestContext) {
  const pid = `e2e-stage3d-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { db, user: u } = await openDemoDb(request);
  const token = jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '1h' });
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'completed', ?, ?)`)
    .run(pid, u.id, 'e2e 导演台 3D', ts, ts);
  db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at)
              VALUES (?, ?, 'storyboard', '镜头 1', ?, '[]', NULL, 1, 1, ?, ?)`)
    .run(`${pid}-sb-1`, pid, JSON.stringify({ description: '雨夜街口,两人对峙' }), ts, ts);
  const cleanup = () => {
    db.prepare('DELETE FROM project_assets WHERE project_id = ?').run(pid);
    db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
    db.close();
  };
  return { pid, token, cleanup };
}

/** 收集页面里所有未捕获异常 / 未处理拒绝 / 控制台错误 —— r3f 渲染器失败最典型的症状就是只剩一条控制台错误 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 开发服务器的 HMR / 字体 / favicon 噪音与本测试无关
    if (/Failed to load resource|favicon|\[HMR\]|webpack-hmr|_next\/static/.test(t)) return;
    errors.push(`console.error: ${t}`);
  });
  return errors;
}

async function openStage(page: Page, pid: string, token: string) {
  await page.addInitScript((t) => localStorage.setItem('qfmj-token', t), token);
  await page.context().addCookies([{ name: 'qfmj-session', value: token, url: process.env.E2E_BASE_URL || 'http://localhost:3000' }]);
  await page.goto(`/projects/${pid}`);
  await page.getByRole('tab', { name: /分镜/ }).click({ timeout: 120_000 });
  await page.getByTitle('导演台 — 拖人摆位、定机位、实时构图体检').first().click({ timeout: 60_000 });
}

/** 标签可见、文字对、中心点落在画布范围内 */
async function expectLabelOnCanvas(page: Page, name: string) {
  const label = page.locator('[data-stage3d-label]').filter({ hasText: name });
  await expect(label).toBeVisible({ timeout: 30_000 });
  const canvasBox = (await page.locator('[data-stage3d-view] canvas').boundingBox())!;
  await expect.poll(async () => {
    const b = await label.boundingBox();
    if (!b) return false;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    return cx > canvasBox.x && cx < canvasBox.x + canvasBox.width && cy > canvasBox.y && cy < canvasBox.y + canvasBox.height;
  }, { timeout: 30_000, message: `标签「${name}」不在画布范围内(没被投影定位?)` }).toBe(true);
}

/** 画布截图的像素标准差:纯黑框 / 纯底色 ≈ 0,画出了地面网格、人偶、天空就明显大于 0 */
async function canvasSpread(page: Page) {
  const png = await page.locator('[data-stage3d-view] canvas').screenshot();
  const { channels } = await sharp(png).stats();
  return Math.max(...channels.slice(0, 3).map((c) => c.stdev));
}

test.describe('导演台 3D 视口(真 WebGL)', () => {
  test.setTimeout(240_000);
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', '桌面验收'); });

  test('成功路:画布真的出图;3D ↔ 2D 反复切换(卸载/重建渲染器)不报错', async ({ page, request }, testInfo) => {
    const { pid, token, cleanup } = await seed(request);
    const errors = watchErrors(page);
    try {
      await openStage(page, pid, token);
      // 有 WebGL2 时导演台默认就是「3D 机位视角」
      const lensTab = page.getByRole('tab', { name: '3D 机位视角' });
      await expect(lensTab, '这台机器的 Chrome 没探到 WebGL2 —— 成功路无从验起').toBeVisible({ timeout: 60_000 });
      await expect(lensTab).toHaveAttribute('aria-selected', 'true');
      const canvas = page.locator('[data-stage3d-view] canvas');
      await expect(canvas).toBeVisible({ timeout: 60_000 });
      // frameloop=demand:首帧画完即止。等到画布真有内容再断言(截图本身也会促使合成)
      await expect.poll(() => canvasSpread(page), { timeout: 30_000, message: '3D 画布是空白/黑框' }).toBeGreaterThan(8);
      // 名字标签(v12.460 起是画布外的 DOM,由场景每帧投影定位):看得见、落在画布里、在人偶头顶那一带
      await expectLabelOnCanvas(page, '角色 A');
      // 在俯视图里用方向键把人往右挪:3D 场景跟着重画(frameloop=demand 靠这次改动触发),标签也得跟过去
      const before = (await page.locator('[data-stage3d-label]').first().boundingBox())!;
      const actor2d = page.getByRole('button', { name: /^角色 A:方向键移动/ });
      await actor2d.focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
      await expect.poll(async () => (await page.locator('[data-stage3d-label]').first().boundingBox())!.x - before.x,
        { timeout: 15_000, message: '人挪了,标签没跟着走' }).toBeGreaterThan(20);
      await page.screenshot({ path: testInfo.outputPath('01-lens.png') });

      // 反复卸载重建:r3f 9.8.1 起根卸载会自动 dispose 渲染器
      for (let i = 0; i < 3; i++) {
        await page.getByRole('tab', { name: '平面' }).click();
        await expect(canvas).toHaveCount(0);
        await page.getByRole('tab', { name: '3D 自由视角' }).click();
        await expect(page.locator('[data-stage3d-view="orbit"] canvas')).toBeVisible({ timeout: 30_000 });
        await lensTab.click();
        await expect(page.locator('[data-stage3d-view="lens"] canvas')).toBeVisible({ timeout: 30_000 });
      }
      await expect.poll(() => canvasSpread(page), { timeout: 30_000, message: '切换后 3D 画布没再画出来' }).toBeGreaterThan(8);
      await expectLabelOnCanvas(page, '角色 A');
      // 自由视角换了相机,标签得跟着重新投影(不是停在机位视角算出来的位置)
      const lensBox = await page.locator('[data-stage3d-label]').first().boundingBox();
      await page.getByRole('tab', { name: '3D 自由视角' }).click();
      await expect(page.locator('[data-stage3d-view="orbit"] canvas')).toBeVisible({ timeout: 30_000 });
      await expectLabelOnCanvas(page, '角色 A');
      const orbitBox = await page.locator('[data-stage3d-label]').first().boundingBox();
      expect(Math.hypot(orbitBox!.x - lensBox!.x, orbitBox!.y - lensBox!.y), '换了视角标签却没动').toBeGreaterThan(5);
      await expect(page.getByText('这台设备建不起 3D 画布')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('02-after-toggle.png') });
      // 关掉导演台 —— 另一条卸载路径(整个弹窗连同画布一起走)
      // 导演台自己的关闭按钮(页面上另有一个 title=「关闭 (Esc)」的按钮,别点错)
      await page.locator('button[aria-label="关闭"]').click();
      await expect(page.locator('[data-stage3d-view] canvas')).toHaveCount(0);
      await expect(page.locator('[data-stage3d-labels]')).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('失败路:WebGL 渲染器建不起来 → 退回 2D 并说明原因,不留黑框、不出未处理拒绝', async ({ page, request }, testInfo) => {
    const { pid, token, cleanup } = await seed(request);
    // 只让**挂进文档的**画布拿不到 WebGL:导演台的探测用离屏画布(isConnected=false)照常通过,
    // 于是走到真正的渲染器工厂里才失败 —— 正是「探测说行、真建时不行」那条路
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type) && this.isConnected) return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    const errors = watchErrors(page);
    try {
      await openStage(page, pid, token);
      await expect(page.getByText('这台设备建不起 3D 画布'), '没退回 2D').toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-stage3d-view] canvas'), '黑框还在').toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('03-fallback.png') });
      // 退回后再点 3D 视角:仍然稳稳退回,不抛
      await page.getByRole('tab', { name: '3D 自由视角' }).click();
      await expect(page.getByText('这台设备建不起 3D 画布')).toBeVisible({ timeout: 30_000 });
      // 工厂里 console.warn 说明原因(不是 error);three 自己建上下文失败会打一条 console.error —— 那条是预期的
      const unexpected = errors.filter((e) => !/Error creating WebGL context/i.test(e));
      expect(unexpected, unexpected.join('\n')).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
