/**
 * v13.3 — 旧库里画幅记成引擎出不了的值(v12.468 前创建页的 2.35:1 等)的项目,改成实际出片的画幅。
 *
 * 这一份用**真库 + 真媒体文件**:素材用 ffmpeg 现做(竖 72x128 / 横 128x72),经 storagePut 落盘,
 * 资产行里存的是生产形态的 `/api/serve-file?key=…`;判定走真的 ffprobe。接线(启动钩子、系列封面 /
 * 导出、MasterPrompt 页)见 v13-3-legacy-aspect-wiring。
 *
 * 锁的是:
 * 1. 判定:镜头级素材多数决;占位片不算;打平 / 量不到才看成片;都没有按现行规则(2.35:1 → 16:9);
 * 2. 修复:只碰三种之外的行;预览不改库;执行带旧值守卫、不改 updated_at、记账;再跑一次没有可改的;
 * 3. 撤销:按账本还原,之后被改过画幅的不动;
 * 4. 启动调度:LEGACY_ASPECT_REPAIR=off 不跑;默认延时后跑、出错不抛;
 * 5. 手动脚本真能在 tsx 下跑起来(子进程,独占测试库);
 * 6. v13.3.1:ffmpeg / ffprobe 一律走仓库自己的解析(ffmpeg-static / ffprobe-static),PATH 上没有也量得到 ——
 *    v13.3 推上去 CI 红在这里(runner 上没有系统 ffmpeg,本机有);找不到能跑的 ffprobe 时一行都不改。
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { insertProjectFull, getProject } from '@/lib/repos/project-repo';
import { createAsset } from '@/lib/repos/asset-repo';
import { storagePut } from '@/lib/storage';
import { resolveFFmpegPath } from '@/services/video-composer';
import {
  decideLegacyAspect, aspectOfSize, measureProjectMedia, findLegacyAspectProjects,
  repairLegacyAspects, restoreLegacyAspects, scheduleLegacyAspectRepair, type MeasuredMedia,
  resolveRunnableFfprobe, ffprobeSizeProbe,
} from '@/lib/legacy-aspect-repair';

// ── 1. 判定(纯函数) ─────────────────────────────────────────────────────
const V = (w: number, h: number): MeasuredMedia => ({ source: 'video', width: w, height: h });
const S = (w: number, h: number): MeasuredMedia => ({ source: 'storyboard', width: w, height: h });
const F = (w: number, h: number): MeasuredMedia => ({ source: 'final_video', width: w, height: h });

describe('v13.3 · 判定', () => {
  it('宽高 → 画幅与 setAspect 同一个函数:1408x600(fal 的 2.35)归 16:9、720x1280 归 9:16、1024x1024 归 1:1', () => {
    expect(aspectOfSize(1408, 600)).toBe('16:9');
    expect(aspectOfSize(720, 1280)).toBe('9:16');
    expect(aspectOfSize(1024, 1024)).toBe('1:1');
    expect(aspectOfSize(0, 720)).toBeNull();
  });

  it('镜头级素材多数决:当年被题材翻成竖屏的 2.35:1 项目 → 9:16(哪怕成片是后来按 16:9 重合成的)', () => {
    const d = decideLegacyAspect('2.35:1', [V(720, 1280), V(720, 1280), S(2848, 1600), S(768, 1344), F(1280, 720)]);
    expect(d).toMatchObject({ to: '9:16', basis: 'shots' });
    expect(d.detail).toContain('3/4');
  });

  it('镜头级横竖打平 → 看成片;镜头级量不到 → 看成片', () => {
    expect(decideLegacyAspect('2.35:1', [V(720, 1280), S(1280, 720), F(720, 1280)])).toMatchObject({ to: '9:16', basis: 'final_video' });
    expect(decideLegacyAspect('2.35:1', [F(1280, 720)])).toMatchObject({ to: '16:9', basis: 'final_video' });
  });

  it.each([
    ['2.35:1', '16:9'], ['21:9', '16:9'], ['3:4', '9:16'], [null, '16:9'], ['', '16:9'], ['wide', '16:9'],
  ])('一件都量不到:旧值 %s → 现行规则 %s', (from, to) => {
    expect(decideLegacyAspect(from as string | null, [])).toMatchObject({ to, basis: 'rule' });
  });
});

// ── 2/3. 真库 + 真媒体 ───────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-3-media-'));
/** 造素材用仓库自己解析的 ffmpeg(ffmpeg-static)—— CI runner 上没有系统 ffmpeg(v13.3 就红在这) */
const FF = resolveFFmpegPath();
const cache = new Map<string, string>();
/** 真媒体文件 → 落盘 → 生产形态的 serve-file URL */
async function media(kind: 'png' | 'mp4', w: number, h: number): Promise<string> {
  const k = `${kind}-${w}x${h}`;
  if (cache.has(k)) return cache.get(k)!;
  const out = path.join(tmp, `${k}.${kind}`);
  const src = kind === 'mp4' ? `color=c=gray:s=${w}x${h}:d=0.2` : `color=c=gray:s=${w}x${h}`;
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', src,
    ...(kind === 'mp4' ? ['-pix_fmt', 'yuv420p', '-c:v', 'libx264'] : ['-frames:v', '1']), out]);
  const put = await storagePut(fs.readFileSync(out), kind === 'mp4' ? 'video/mp4' : 'image/png', `.${kind}`);
  expect(put.url).toMatch(/^\/api\/serve-file\?key=/); // 生产形态,不是直接给本地路径
  cache.set(k, put.url);
  return put.url;
}

let userId = '';
beforeAll(() => {
  userId = `u-${nanoid(8)}`;
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(userId, `${userId}@test.local`, 'x', userId, now());
});

const OLD_UPDATED_AT = '2026-01-01T00:00:00.000Z';
async function project(aspect: string | null, assets: Array<{ type: string; url: string; shot?: number; data?: Record<string, unknown> }> = []): Promise<string> {
  const id = `p133-${nanoid(8)}`;
  await insertProjectFull({ id, userId, title: '旧项目', description: '', coverUrls: [], status: 'completed', aspect: 'x' });
  db.prepare('UPDATE projects SET aspect = ?, updated_at = ? WHERE id = ?').run(aspect, OLD_UPDATED_AT, id);
  for (const a of assets) {
    await createAsset({ projectId: id, type: a.type, name: a.type, data: a.data ?? {}, mediaUrls: [a.url], persistentUrl: a.url, shotNumber: a.shot ?? null });
  }
  return id;
}
const aspectOf = async (id: string) => (await getProject(id))?.aspect;
const updatedAtOf = (id: string) => (db.prepare('SELECT updated_at FROM projects WHERE id = ?').get(id) as { updated_at: string }).updated_at;
const ledger = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v13-3-ledger-')), 'legacy-aspect-repaired.json');
/** 每个用例只看自己建的项目(同一个测试库里还有别的用例的行) */
const mine = (ids: string[], changes: Array<{ id: string }>) => changes.filter((c) => ids.includes(c.id));

describe('v13.3 · 真库修复', { timeout: 60_000 }, () => {
  it('量真素材:竖屏镜头 → 9:16;占位片(1280x720 Ken Burns)不算票;serve-file?key= 能解析到本地文件', async () => {
    const v = await media('mp4', 72, 128);
    const sb = await media('png', 72, 128);
    const landscape = await media('mp4', 128, 72);
    const id = await project('2.35:1', [
      { type: 'video', url: v, shot: 1 }, { type: 'video', url: v, shot: 2 },
      { type: 'video', url: landscape, shot: 3, data: { isAnimatic: true } }, // 占位片
      { type: 'video', url: landscape, shot: 4, data: { isAnimatic: true } },
      { type: 'video', url: landscape, shot: 5, data: { isAnimatic: true } },
      { type: 'storyboard', url: sb, shot: 1 },
    ]);
    const m = await measureProjectMedia(id);
    expect(m.map((x) => `${x.source}:${x.width}x${x.height}`).sort()).toEqual(['storyboard:72x128', 'video:72x128', 'video:72x128']);
    expect(decideLegacyAspect('2.35:1', m).to).toBe('9:16'); // 要是占位片算票,3:3 打平就不是这个结果
  });

  it('预览不改库;执行只改三种之外的行、不动 updated_at、记账;再跑一次没有可改的', async () => {
    const vertical = await project('2.35:1', [{ type: 'video', url: await media('mp4', 72, 128), shot: 1 }]);
    const noMedia = await project('2.35:1');
    const nullAspect = await project(null, [{ type: 'storyboard', url: await media('png', 128, 72), shot: 1 }]);
    const finalOnly = await project('21:9', [{ type: 'final_video', url: await media('mp4', 72, 128) }]);
    const ok916 = await project('9:16', [{ type: 'video', url: await media('mp4', 128, 72), shot: 1 }]);
    const ok169 = await project('16:9');
    const ids = [vertical, noMedia, nullAspect, finalOnly, ok916, ok169];

    const legacyIds = (await findLegacyAspectProjects()).map((r) => r.id);
    expect(legacyIds).toEqual(expect.arrayContaining([vertical, noMedia, nullAspect, finalOnly]));
    expect(legacyIds).not.toContain(ok916); // 三种之内的一概不碰 —— 哪怕素材和它对不上
    expect(legacyIds).not.toContain(ok169);

    const book = ledger();
    const preview = await repairLegacyAspects({ apply: false, ledgerPath: book });
    expect(mine(ids, preview.changes).map((c) => [c.id, c.to, c.basis, c.applied])).toEqual([
      [vertical, '9:16', 'shots', false], [noMedia, '16:9', 'rule', false],
      [nullAspect, '16:9', 'shots', false], [finalOnly, '9:16', 'final_video', false],
    ]);
    expect(await aspectOf(vertical)).toBe('2.35:1');
    expect(fs.existsSync(book)).toBe(false);

    const run = await repairLegacyAspects({ apply: true, ledgerPath: book, now: () => '2026-10-17T00:00:00.000Z' });
    expect(mine(ids, run.changes).every((c) => c.applied)).toBe(true);
    expect([await aspectOf(vertical), await aspectOf(noMedia), await aspectOf(nullAspect), await aspectOf(finalOnly)])
      .toEqual(['9:16', '16:9', '16:9', '9:16']);
    expect([await aspectOf(ok916), await aspectOf(ok169)]).toEqual(['9:16', '16:9']);
    for (const id of [vertical, noMedia, nullAspect, finalOnly]) expect(updatedAtOf(id)).toBe(OLD_UPDATED_AT);
    const entries = JSON.parse(fs.readFileSync(book, 'utf-8'));
    expect(entries.filter((e: { id: string }) => ids.includes(e.id))).toEqual([
      expect.objectContaining({ id: vertical, from: '2.35:1', to: '9:16', basis: 'shots' }),
      expect.objectContaining({ id: noMedia, from: '2.35:1', to: '16:9', basis: 'rule' }),
      expect.objectContaining({ id: nullAspect, from: null, to: '16:9' }),
      expect.objectContaining({ id: finalOnly, from: '21:9', to: '9:16', basis: 'final_video' }),
    ]);

    const again = await repairLegacyAspects({ apply: true, ledgerPath: book });
    expect(mine(ids, again.changes)).toEqual([]);
  });

  it('扫描后、写入前被别处改了画幅(比如用户重跑)→ 不覆盖', async () => {
    const id = await project('2.35:1', [{ type: 'video', url: await media('mp4', 72, 128), shot: 1 }]);
    const r = await repairLegacyAspects({
      apply: true, ledgerPath: ledger(),
      probe: async (p) => {
        db.prepare('UPDATE projects SET aspect = ? WHERE id = ?').run('1:1', id); // 量素材期间被改
        return ffprobeSizeProbe((await resolveRunnableFfprobe())!)(p);
      },
    });
    expect(mine([id], r.changes)).toEqual([expect.objectContaining({ id, to: '9:16', applied: false })]);
    expect(await aspectOf(id)).toBe('1:1');
  });

  it('v13.3.1 · PATH 上没有 ffprobe / ffmpeg 也量得到(CI 与只装了 npm 依赖的源码部署就是这样)', async () => {
    const v = await media('mp4', 72, 128);
    const id = await project('2.35:1', [{ type: 'video', url: v, shot: 1 }]);
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(await measureProjectMedia(id)).toEqual([{ source: 'video', width: 72, height: 128 }]);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('v13.3.1 · 反面:找不到能跑的 ffprobe → 一行都不判、不改、不记账(否则竖屏项目会被按规则写成 16:9)', async () => {
    const id = await project('2.35:1', [{ type: 'video', url: await media('mp4', 72, 128), shot: 1 }]);
    const book = ledger();
    const r = await repairLegacyAspects({ apply: true, ledgerPath: book, ffprobePath: path.join(tmp, 'no-such-ffprobe') });
    expect(r.probeMissing).toBe(true);
    expect(r.scanned).toBeGreaterThan(0);
    expect(r.changes).toEqual([]);
    expect(await aspectOf(id)).toBe('2.35:1');
    expect(fs.existsSync(book)).toBe(false);
    // 对照:同一个库、能跑的 ffprobe → 按素材改成 9:16
    const ok = await repairLegacyAspects({ apply: true, ledgerPath: book });
    expect(ok.probeMissing).toBeFalsy();
    expect(await aspectOf(id)).toBe('9:16');
  });

  it('撤销:按账本还原;改正后又被重跑改过画幅的不动、留在账本里', async () => {
    const a = await project('2.35:1', [{ type: 'video', url: await media('mp4', 72, 128), shot: 1 }]);
    const b = await project('2.35:1');
    const book = ledger();
    await repairLegacyAspects({ apply: true, ledgerPath: book });
    expect([await aspectOf(a), await aspectOf(b)]).toEqual(['9:16', '16:9']);
    db.prepare('UPDATE projects SET aspect = ? WHERE id = ?').run('1:1', b); // 用户之后重跑换了画幅

    const r = await restoreLegacyAspects({ ledgerPath: book });
    expect(r.restored).toContain(a);
    expect(r.skipped).toContain(b);
    expect([await aspectOf(a), await aspectOf(b)]).toEqual(['2.35:1', '1:1']);
    const left = JSON.parse(fs.readFileSync(book, 'utf-8')).map((e: { id: string }) => e.id);
    expect(left).toContain(b);
    expect(left).not.toContain(a);
  });
});

// ── 4. 启动调度 ────────────────────────────────────────────────────────────
describe('v13.3 · 启动后在后台跑一次', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('LEGACY_ASPECT_REPAIR=off → 不排程', () => {
    const run = vi.fn();
    expect(scheduleLegacyAspectRepair({ env: { LEGACY_ASPECT_REPAIR: ' OFF ' }, run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('默认:延时后跑、逐条打印改了什么;没有旧行就不出声', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const run = vi.fn(async () => ({ scanned: 1, changes: [{ id: 'p1', from: '2.35:1', to: '9:16' as const, basis: 'shots' as const, detail: '镜头素材 2/2 为 9:16', applied: true }] }));
    expect(scheduleLegacyAspectRepair({ env: {}, run, log: (m) => logs.push(m), delayMs: 1000 })).not.toBeNull();
    expect(run).not.toHaveBeenCalled(); // 不阻塞启动
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledOnce();
    expect(logs.join('\n')).toContain('p1: 2.35:1 → 9:16');
    expect(logs.join('\n')).toContain('repair:aspect -- --restore');

    const quiet: string[] = [];
    scheduleLegacyAspectRepair({ env: {}, run: async () => ({ scanned: 0, changes: [] }), log: (m) => quiet.push(m), delayMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(quiet).toEqual([]);
  });

  it('v13.3.1 · 找不到 ffprobe → 日志说清一个都没改、下次启动再试,不打「已改正」', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    scheduleLegacyAspectRepair({ env: {}, run: async () => ({ scanned: 3, changes: [], probeMissing: true }), log: (m) => logs.push(m), delayMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(logs.join('\n')).toContain('找不到能运行的 ffprobe');
    expect(logs.join('\n')).toContain('本次一个都没改');
    expect(logs.join('\n')).not.toContain('已改正');
  });

  it('修复出错 → 只记日志,不抛(不该让服务起不来)', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    scheduleLegacyAspectRepair({ env: {}, run: async () => { throw new Error('db gone'); }, log: (m) => logs.push(m), delayMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(logs.join('\n')).toContain('自动修复失败(不影响服务):db gone');
  });
});

// ── 5. 手动脚本 ─────────────────────────────────────────────────────────────
describe('v13.3 · npm run repair:aspect 真能跑', { timeout: 120_000 }, () => {
  it('tsx 下加载得了整条依赖链并跑完预览(子进程用自己的独占测试库,不碰 data/qfmj.db)', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['repair:aspect']).toBe('tsx scripts/repair-legacy-aspect.mjs');
    const r = spawnSync(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/repair-legacy-aspect.mjs'], {
      encoding: 'utf-8', env: { ...process.env, VITEST: '1', NODE_ENV: 'test' }, timeout: 110_000,
    });
    expect(r.stderr).not.toMatch(/Error|Cannot find/);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('没有画幅不在 16:9 / 9:16 / 1:1 之内的项目');
  });
});
