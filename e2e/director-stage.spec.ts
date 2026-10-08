import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { openDemoDb } from './helpers/demo-db';

/**
 * 导演台(摆位弹窗)在真浏览器里走一遍用户会做的每一步:
 *   剧本角色建人 → 俯视图键盘/拖动摆位、转朝向 → 焦距/机高/机位朝向/俯仰(对准人物)→ 姿态 → 照片识别姿态 →
 *   2D/3D 预览同步 → 构图体检 → 保存 → 关掉重开还原 → 刷新后分镜卡仍标「已摆位」→ 渲布局草图(竖屏出竖图)。
 * 每一步都回到**用户看得到的东西**(提示词原文、告警、图片尺寸)或**库里的数据**核对。
 *
 * 一次性项目(归属 demo 账号,9:16),测完删除。服务器 JWT_SECRET 须与本文件一致;建议 MOCK_ENGINES=1。
 * 跑法(在仓库根目录):`MOCK_ENGINES=1 JWT_SECRET=e2e-fixture-secret-not-for-prod npx playwright test e2e/director-stage.spec.ts --project=desktop`
 * —— :3000 上没有服务时 Playwright 会自己起 `npm run dev`(带上这两个环境变量);已有手动起的服务则直接复用,它的密钥得一致。
 */
const SECRET = process.env.JWT_SECRET || 'e2e-fixture-secret-not-for-prod';
/**
 * 照片识别用的两张图,直接从仓库自带的图里取,不用另外准备:
 *   · 全身正面 —— 从角色设定截图(assets/v12-425/08-character-sheets.jpg)里裁出西装那位;
 *   · 半身像   —— public/styles/portrait-natural.jpg(只到肩膀,应得到「判不准」而不是瞎猜)。
 * 想换自己的照片:POSE_PHOTO_DIR 指向一个放着同名两张图的目录。
 */
async function posePhotos(outDir: string): Promise<{ full: string; half: string }> {
  const dir = process.env.POSE_PHOTO_DIR;
  if (dir) return { full: path.join(dir, 'pose-suit-front.jpg'), half: path.join(dir, 'portrait-natural.jpg') };
  fs.mkdirSync(outDir, { recursive: true });
  const full = path.join(outDir, 'pose-suit-front.jpg');
  await sharp('assets/v12-425/08-character-sheets.jpg').extract({ left: 1005, top: 555, width: 175, height: 436 }).resize({ height: 872 }).toFile(full);
  return { full, half: path.resolve('public/styles/portrait-natural.jpg') };
}

async function seed(request: APIRequestContext) {
  const pid = `e2e-dstage-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { db, user: u } = await openDemoDb(request);
  const token = jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '1h' });
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, ?, ?, 'completed', '9:16', ?, ?)`)
    .run(pid, u.id, 'e2e 导演台走查', ts, ts);
  const put = (type: string, name: string, data: unknown, shot: number | null) =>
    db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, '[]', NULL, ?, 1, ?, ?)`)
      .run(`${pid}-${type}-${shot ?? 0}`, pid, type, name, JSON.stringify(data), shot, ts, ts);
  put('script', '剧本', {
    title: '雨夜', shots: [
      { shotNumber: 1, characters: ['林晚', '陆沉'], description: '雨夜街口,两人对峙', emotion: 'tense' },
      { shotNumber: 2, characters: [], description: '空镜:霓虹招牌' },
    ],
  }, null);
  put('storyboard', '镜头 1', { description: '雨夜街口,两人对峙' }, 1);
  put('storyboard', '镜头 2', { description: '空镜:霓虹招牌' }, 2);
  const stageRow = () => db.prepare(`SELECT data FROM project_assets WHERE project_id=? AND type='stage-scene' AND shot_number=1`).get(pid) as { data: string } | undefined;
  const cleanup = () => {
    db.prepare('DELETE FROM project_assets WHERE project_id = ?').run(pid);
    db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
    db.close();
  };
  return { pid, token, stageRow, cleanup };
}

async function login(page: Page, token: string) {
  await page.addInitScript((t) => localStorage.setItem('qfmj-token', t), token);
  await page.context().addCookies([{ name: 'qfmj-session', value: token, url: process.env.E2E_BASE_URL || 'http://localhost:3000' }]);
}
async function openStage(page: Page, pid: string, shotIdx = 0) {
  await page.goto(`/projects/${pid}`);
  await page.getByRole('tab', { name: /分镜/ }).click({ timeout: 120_000 });
  await page.getByTitle('导演台 — 拖人摆位、定机位、实时构图体检').nth(shotIdx).click({ timeout: 60_000 });
  await expect(stageDialog(page)).toBeVisible({ timeout: 30_000 });
}
const stageDialog = (page: Page) => page.getByRole('dialog', { name: /导演台 · 第/ });
const directive = async (page: Page) => {
  const d = stageDialog(page).locator('details code');
  return (await d.count()) ? (await d.textContent()) ?? '' : '';
};

test.describe('导演台走查(真浏览器)', () => {
  test.setTimeout(600_000);
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', '桌面验收'); });

  test('完整用户路径', async ({ page, request }, testInfo) => {
    const { pid, token, stageRow, cleanup } = await seed(request);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // MediaPipe 的 wasm 把 INFO / 警告日志写到 console.error(「Created TensorFlow Lite XNNPACK delegate」等)—— 第三方库的普通日志,不是页面报错
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|HMR|webpack|XNNPACK delegate|gl_context\.cc/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
    const log = (s: string) => console.log(`[走查] ${s}`);
    try {
      await login(page, token);
      await openStage(page, pid);
      const dlg = stageDialog(page);

      // ① 剧本角色建人
      const poseRows = dlg.locator('[data-pose-row]');
      log(`人物行: ${(await poseRows.allTextContents()).map((t) => t.slice(0, 6)).join(' | ')}`);
      expect.soft(await poseRows.count(), '剧本里这镜有两个角色').toBe(2);
      await page.screenshot({ path: testInfo.outputPath('01-open.png') });
      const d0 = await directive(page);
      log(`初始提示词: ${d0}`);

      // ② 键盘摆位 + 朝向
      const lin = dlg.getByRole('button', { name: /^林晚:方向键移动/ });
      await lin.focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('e');
      const d1 = await directive(page);
      log(`键盘左移+转朝向后: ${d1}`);
      expect.soft(d1, '键盘移动/转向后提示词应变化').not.toBe(d0);
      expect.soft(d1, '设了朝向后提示词应带朝向').toMatch(/facing|profile|toward|back/i);

      // ③ 鼠标拖陆沉
      const lu = dlg.locator('g[data-actor]').nth(1);
      const b = (await lu.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 - 30, { steps: 8 });
      await page.mouse.up();
      const d2 = await directive(page);
      log(`拖动陆沉后: ${d2}`);
      expect.soft(d2, '拖动后提示词应变化').not.toBe(d1);

      // ④ 焦距 / 机高 / 机位朝向
      const fovText = async () => (await dlg.getByText(/° 视角$/).textContent()) ?? '';
      const fov35 = await fovText();
      await dlg.getByRole('button', { name: '85mm', exact: true }).click();
      const fov85 = await fovText();
      log(`视角 35mm=${fov35} 85mm=${fov85}`);
      expect.soft(fov85, '换长焦视角应变窄').not.toBe(fov35);
      const sliders = dlg.locator('input[type="range"]');
      await sliders.nth(1).fill('2.4');   // 高机位但人还在画框里(85mm、平视,拉到 3 米以上人会整个落到画面下方之外)
      await sliders.nth(0).fill('10');
      const d3 = await directive(page);
      log(`85mm+机高2.4+朝向10°: ${d3}`);
      // v12.465:没设俯仰 = 镜头水平 —— 照实说「抬高的平视」,不再写成俯拍(修前提示词说俯拍、预览和草图却是平的)
      expect.soft(d3, '抬高但镜头水平').toMatch(/raised above eye level, lens kept level/i);
      expect.soft(d3).not.toMatch(/high-angle/i);
      // ④b 俯仰:「对准人物」压下镜头 → 提示词写俯拍、2D 预览地平线上移、3D 机位视角跟着低头
      // 地平线画在「平面」预览里;有 WebGL2 时默认打开的是 3D 视口,先切过去。读属性给超时 —— 线出了画面就不存在,别一直等
      const flatTab = dlg.getByRole('tab', { name: '平面' });
      if (await flatTab.count()) await flatTab.click();
      const horizonY = async () => Number(await dlg.locator('line[data-horizon]').first().getAttribute('y1', { timeout: 5000 }).catch(() => 'NaN'));
      const h0 = await horizonY();
      expect.soft(Number.isNaN(h0), '平视时地平线在画面里').toBe(false);
      await dlg.getByRole('button', { name: '对准人物' }).click();
      const pitch = Number(await dlg.getByLabel('俯仰', { exact: true }).inputValue());
      const d3b = await directive(page);
      log(`对准人物 → 俯仰 ${pitch}°: ${d3b} | 视角说法: ${await dlg.locator('[data-camera-view]').textContent()} | 地平线 y ${h0} → ${await horizonY()}`);
      expect.soft(pitch, '机位高于人 → 往下压').toBeLessThan(-8);
      expect.soft(d3b, '真低头了才写俯拍').toMatch(/high-angle camera looking down/i);
      expect.soft(await dlg.locator('[data-camera-view]').textContent()).toBe('高角度俯拍机位');
      const h1 = await horizonY();
      expect.soft(Number.isNaN(h1) || h1 < h0, '低头 → 地平线上移(或移出画面)').toBe(true);
      const lensTab = dlg.getByRole('tab', { name: '3D 机位视角' });
      if (await lensTab.count()) {
        await lensTab.click(); await page.waitForTimeout(1500);
        await page.screenshot({ path: testInfo.outputPath('01b-俯仰-3D机位视角.png') });
        await dlg.getByRole('tab', { name: '平面' }).click();
      }

      // ⑤a 人物管理(v12.462):加一个 → 改名 → 提示词跟着变 → 删掉
      await dlg.getByRole('button', { name: /添加人物/ }).click();
      expect.soft(await poseRows.count(), '添加人物后应有 3 行').toBe(3);
      await dlg.getByLabel('角色 A 的名字').fill('老周');
      log(`加人并改名后: ${await directive(page)}`);
      await dlg.getByRole('button', { name: '移除 老周' }).click();
      expect.soft(await poseRows.count(), '删掉后回到 2 行').toBe(2);
      // 点「焦距」二字不该改焦距(v12.462 前包在 label 里,会触发 18mm)
      await dlg.getByText('焦距', { exact: true }).click();
      expect.soft(await dlg.locator('[role="group"][aria-label="焦距"] button[aria-pressed="true"]').textContent()).toBe('85mm');

      // ⑤ 姿态
      // 林晚换 85mm 后已出画 —— 画外的人不进提示词,姿态也不进;落库照存(下面核对)。提示词用画内的陆沉验
      await dlg.getByLabel('林晚 的姿态', { exact: true }).selectOption({ label: '坐着' });
      await dlg.getByLabel('陆沉 的姿态', { exact: true }).selectOption({ label: '举手' });
      const d4 = await directive(page);
      log(`林晚坐下、陆沉举手: ${d4}`);
      expect.soft(d4).toMatch(/rais/i);

      // ⑥ 照片识别(真推理)
      {
        const photos = await posePhotos(testInfo.outputDir);
        const input = dlg.getByLabel('陆沉 的姿态参考照片');
        await input.setInputFiles(photos.full);
        const row = dlg.locator('[data-pose-row]').nth(1);
        await expect.poll(async () => (await row.textContent()) ?? '', { timeout: 90_000 }).toMatch(/已识别|不太确定|没认出|判不准|跑不了|没带/);
        log(`照片识别(全身正面): ${(await row.textContent())?.replace(/\s+/g, ' ')}`);
        // 上面的等待把「跑不了 / 没带模型」也算作有结果(否则会干等满 90 秒);但这一步要验的是**真推理** ——
        // CI 里 MediaPipe 没跑起来就该红,而不是被当成「识别完了」放过去
        expect.soft((await row.textContent()) ?? '', '姿态识别应真的跑了推理(不是「跑不了」或「没带模型」)').not.toMatch(/跑不了|没带/);
        expect.soft((await row.textContent()) ?? '', '窗口自证:这一行确实给出了识别结果').toMatch(/已识别|不太确定|没认出|判不准/);
        log(`陆沉姿态下拉: ${await dlg.getByLabel('陆沉 的姿态', { exact: true }).inputValue()}`);
        await input.setInputFiles(photos.half);
        await page.waitForTimeout(8000);
        log(`照片识别(半身像): ${(await row.textContent())?.replace(/\s+/g, ' ')}`);
      }

      // ⑦ 2D / 3D 预览、构图体检
      for (const tab of ['3D 机位视角', '3D 自由视角', '平面']) {
        const t = dlg.getByRole('tab', { name: tab });
        if (await t.count()) { await t.click(); await page.waitForTimeout(1200); await page.screenshot({ path: testInfo.outputPath(`02-${tab}.png`) }); }
        else log(`没有「${tab}」预览选项`);
      }
      // 把林晚挪出画面 → 体检应告警
      await lin.focus();
      for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowLeft');
      const warn = await dlg.locator('p.flex.items-start').allTextContents();
      log(`挪出画面后体检: ${warn.join(' / ') || '(无告警)'}`);
      expect.soft(warn.join(''), '出画应告警').toMatch(/画外|出画|画面外/);
      for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowRight');

      // ⑧ 保存 → 落库
      const before = await directive(page);
      await dlg.getByRole('button', { name: /保存站位/ }).click();
      await expect(dlg.getByText(/已保存/)).toBeVisible({ timeout: 30_000 });
      const savedMsg = (await dlg.getByText(/已保存/).textContent()) ?? '';
      log(`保存提示: ${savedMsg}`);
      expect.soft(savedMsg, '这镜已有分镜图,第一次摆位应提示已标记待重渲').toContain('待重渲');
      const saved = JSON.parse(stageRow()?.data || '{}');
      log(`库里: camera=${JSON.stringify(saved.camera)} actors=${JSON.stringify(saved.actors)}`);
      expect.soft(saved.camera?.lens).toBe('85');
      expect.soft(saved.camera?.pitchDeg, '俯仰存进库').toBeLessThan(-8);
      expect.soft(saved.actors?.find((a: any) => a.name === '林晚')?.posePreset).toBe('sitting');

      // ⑨ 关掉重开 → 还原
      await page.locator('button[aria-label="关闭"]').click();
      await expect(dlg).toHaveCount(0);
      const card1 = page.getByTitle('导演台 — 拖人摆位、定机位、实时构图体检').first();
      log(`关台后分镜卡按钮: ${(await card1.textContent())?.trim()}`);
      await card1.click();
      await expect(stageDialog(page)).toBeVisible({ timeout: 30_000 });
      const after = await directive(page);
      expect.soft(after, '重开后提示词应与保存前一致').toBe(before);
      expect.soft(await stageDialog(page).getByLabel('林晚 的姿态', { exact: true }).inputValue()).toBe('sitting');

      log(`到此为止的页面报错: ${errors.length ? errors.join(' || ').slice(0, 1500) : '无'}`);
      // ⑩ 渲布局草图(竖屏项目 → 竖图)。先把机位放回 1.6 米、俯仰归零、35mm,草图里才看得到人
      await stageDialog(page).locator('input[type="range"]').nth(1).fill('1.6');
      await stageDialog(page).getByLabel('俯仰', { exact: true }).fill('0');
      await stageDialog(page).getByRole('button', { name: '35mm', exact: true }).click();
      await stageDialog(page).getByRole('button', { name: /渲布局草图/ }).click();
      const img = stageDialog(page).getByAltText('第 1 镜布局草图');
      await expect(img).toBeVisible({ timeout: 120_000 });
      const src = await img.getAttribute('src');
      const buf = Buffer.from(await (await page.request.get(src!)).body());
      const meta = await sharp(buf).metadata();
      log(`草图 ${meta.width}×${meta.height} src=${src?.slice(0, 60)}`);
      expect.soft(meta.height! > meta.width!, '9:16 项目应出竖图').toBe(true);
      await page.screenshot({ path: testInfo.outputPath('03-sketch.png') });
      await page.locator('button[aria-label="关闭"]').click();
      // ⑩b 重开:草图还在,并说清来源(v12.462 前重开就不见了)
      await page.getByTitle('导演台 — 拖人摆位、定机位、实时构图体检').first().click();
      const fig = stageDialog(page).locator('figure[data-sketch-mode]');
      await expect(fig).toBeVisible({ timeout: 30_000 });
      log(`重开后草图: mode=${await fig.getAttribute('data-sketch-mode')} 说明=${(await fig.locator('figcaption').textContent())?.trim()}`);
      // 挪一下人再存:导演台草图应跟着重渲(地址变)
      await stageDialog(page).getByRole('button', { name: /^林晚:方向键移动/ }).focus();
      await page.keyboard.press('Shift+ArrowRight');
      await stageDialog(page).getByRole('button', { name: /保存站位/ }).click();
      await expect(stageDialog(page).getByText(/已保存/)).toBeVisible({ timeout: 30_000 });
      log(`挪人再存: ${(await stageDialog(page).getByText(/已保存/).textContent())}`);
      const src2 = await stageDialog(page).locator('figure img').getAttribute('src');
      expect.soft(src2, '导演台草图应按新站位重渲').not.toBe(src);
      await page.locator('button[aria-label="关闭"]').click();

      // ⑪ 刷新页面 → 分镜卡是否仍标「已摆位」
      await page.reload();
      await page.getByRole('tab', { name: /分镜/ }).click({ timeout: 120_000 });
      const txt = (await page.getByTitle('导演台 — 拖人摆位、定机位、实时构图体检').first().textContent())?.trim();
      log(`刷新后分镜卡按钮: ${txt}`);
      expect.soft(txt, '刷新后已摆过位的镜仍应标出来').toMatch(/已摆位/);

      // ⑫ 没有角色的镜
      await openStage(page, pid, 1);
      log(`空镜人物行: ${(await stageDialog(page).locator('[data-pose-row]').allTextContents()).join(' | ')}`);
      await page.screenshot({ path: testInfo.outputPath('04-empty-shot.png') });

      log(`页面错误: ${errors.length ? errors.join('\n') : '无'}`);
      expect.soft(errors).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
