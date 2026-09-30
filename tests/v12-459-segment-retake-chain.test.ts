/**
 * v12.459 · 片段重拍端到端真跑(真库 + 真 ffmpeg;补丁由本测试用 ffmpeg 现造,不调引擎、不花钱)。
 *
 * v12.315–v12.458:路由把调用方给的裸补丁原样记成 take,缝合层全仓零调用;采用时整镜被换成补丁,
 * 且采用只改 media_urls 不改 persistent_url(重新合成读的是后者 → 采用了等于没采用),
 * 还用 take 的 data 整个替换活动版 data(该镜 duration 丢失)。这里把整条链真跑一遍锁住。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveFFmpegPath, resolveFFprobePath } from '@/services/video-composer';
import { runSegmentRetake, tryLockShot, SegmentRetakeError, SEG_RETAKE_MEDIA_KIND, type GeneratePatch } from '@/services/segment-retake-run';
import { adoptSegmentTake, listSegmentTakes } from '@/lib/shot-segment-retake';
import { createAsset, getAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { serveFilePathUrl, resolveVerifiedServeFilePath } from '@/lib/serve-file-sign';
import { persistentMediaDir } from '@/lib/media-persist';
import { db, now } from '@/lib/db';

const FF = resolveFFmpegPath();
const FP = resolveFFprobePath();
const HAS_FFMPEG = spawnSync(FF, ['-version']).status === 0 && spawnSync(FP, ['-version']).status === 0;
const SLOW = 180_000;

let dir = '';
const fx = (n: string) => path.join(dir, n);
const ff = (args: string[]) => execFileSync(FF, ['-v', 'error', '-y', ...args]);
const PID = `v12459-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const UID = `u-${PID}`;
/** 外键是开着的:项目行要真的存在(归属一个真用户) */
const pid = (n: number) => {
  const id = `${PID}-${n}`;
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(UID, `${UID}@t.local`, 'x', 't', now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, 'v12.459', 'draft', ?, ?)`)
    .run(id, UID, now(), now());
  return id;
};

function frames(file: string): number {
  const j = JSON.parse(execFileSync(FP, ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_streams', '-of', 'json', file]).toString());
  return Number(j.streams[0].nb_read_frames);
}

/** 建一个「出过片」的项目:timeline(镜 1 = 8s)、24fps、镜 1 活动版视频指向本地原片 */
async function seedProject(projectId: string, opts: { isAnimatic?: boolean; persistent?: boolean; srcName?: string } = {}) {
  const src = serveFilePathUrl(fx(opts.srcName ?? 'src.mp4'));
  await createAsset({ projectId, type: 'timeline', name: 'timeline', data: { timeline: [{ shotNumber: 1, duration: 8 }] } });
  await createAsset({ projectId, type: 'project-format', name: 'format', data: { fps: 24 } });
  await createAsset({
    projectId, type: 'video', name: '镜 1', shotNumber: 1,
    data: { duration: 8, status: 'completed', ...(opts.isAnimatic ? { isAnimatic: true } : {}) },
    mediaUrls: [src], persistentUrl: opts.persistent === false ? null : src,
  });
  await createAsset({ projectId, type: 'storyboard', name: '分镜 1', shotNumber: 1, data: { description: '她在雨里回头' } });
  return src;
}

/** 造补丁的假引擎:记录收到的参数,返回本地补丁的 serve-file 地址 */
function fakeEngine(file: string, opts: { isAnimatic?: boolean } = {}) {
  const calls: Array<Parameters<GeneratePatch>[0] & { firstFrameExisted: boolean }> = [];
  const gen: GeneratePatch = async (args) => {
    const p = args.firstFrameUrl ? resolveVerifiedServeFilePath(args.firstFrameUrl) : null;
    calls.push({ ...args, firstFrameExisted: !!p && fs.existsSync(p) });
    return { videoUrl: serveFilePathUrl(file), isAnimatic: !!opts.isAnimatic };
  };
  return { gen, calls };
}

// 夹具在文件级生成 / 清理:几个 describe 共用(v12.459 复查补的用例在第二个 describe 里)
beforeAll(() => {
  if (!HAS_FFMPEG) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v12459-'));
  const video = ['-c:v', 'libx264', '-crf', '12', '-g', '48', '-pix_fmt', 'yuv420p'];
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '8', ...video, '-c:a', 'aac', '-ac', '1', '-ar', '48000', fx('src.mp4')]);
  // 引擎出的补丁:3s、30fps、分辨率与采样率都和原片不同
  ff(['-f', 'lavfi', '-i', 'smptebars=size=480x270:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-ar', '44100', fx('patch.mp4')]);
  // 整镜重拍用的 8s 补丁
  ff(['-f', 'lavfi', '-i', 'smptebars=size=480x270:rate=30', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fx('patch8.mp4')]);
  // 太短的补丁(1s)—— 引擎给的比要的短,缝出来的时长必然对不上
  ff(['-f', 'lavfi', '-i', 'smptebars=size=480x270:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fx('short.mp4')]);
}, SLOW);

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  const md = persistentMediaDir(SEG_RETAKE_MEDIA_KIND);
  for (const f of fs.readdirSync(md)) if (f.includes(PID)) fs.rmSync(path.join(md, f), { force: true });
});

describe.skipIf(!HAS_FFMPEG)('v12.459 · 片段重拍端到端', () => {

  it('生成补丁 → 缝合 → 落盘 → 记 take:take 指向缝合产物,时长一帧不差', async () => {
    const projectId = pid(1);
    await seedProject(projectId);
    const eng = fakeEngine(fx('patch.mp4'));
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5, prompt: '别眨眼' }, { generatePatch: eng.gen });

    // 生成函数拿到的参数:按计划的生成时长、带原片切入点那一帧、带用户的修改说明
    expect(eng.calls).toHaveLength(1);
    expect(eng.calls[0].durationS).toBe(r.plan.generateDurationS);
    expect(eng.calls[0].firstFrameUrl, '要带原片切入点的那一帧').toMatch(/^\/api\/serve-file\?path=/);
    expect(eng.calls[0].firstFrameExisted, '调用时首帧文件必须真的在').toBe(true);
    expect(eng.calls[0].promptExtra).toBe('别眨眼');
    // 首帧用完即删
    expect(fs.existsSync(resolveVerifiedServeFilePath(eng.calls[0].firstFrameUrl!)!)).toBe(false);

    // 产物:站内持久目录里的真文件,192 帧 = 8s × 24
    const out = resolveVerifiedServeFilePath(r.videoUrl)!;
    expect(out.startsWith(persistentMediaDir(SEG_RETAKE_MEDIA_KIND))).toBe(true);
    expect(fs.existsSync(out)).toBe(true);
    expect(frames(out)).toBe(192);
    expect(Math.abs(r.measuredDurationS - 8)).toBeLessThan(1 / 24);

    // take:media_urls 与 persistent_url 都是缝合产物(不是裸补丁)
    const take = await getAsset(r.takeId);
    expect(JSON.parse(take!.media_urls || '[]')[0]).toBe(r.videoUrl);
    expect(take!.persistent_url).toBe(r.videoUrl);
    expect(JSON.parse(take!.media_urls || '[]')[0], '不能是裸补丁').not.toBe(serveFilePathUrl(fx('patch.mp4')));
    const listed = await listSegmentTakes(projectId, 1);
    expect(listed[0]).toMatchObject({ takeId: r.takeId, adopted: false, original: false, patchIsAnimatic: false });
  }, SLOW);

  it('**采用**:活动版 persistent_url 与 media_urls 都换成缝合产物,该镜 duration/status 保留;首次采用自动记下原片', async () => {
    const projectId = pid(2);
    const srcUrl = await seedProject(projectId);
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 2, toS: 4 }, { generatePatch: fakeEngine(fx('patch.mp4')).gen });

    const a = await adoptSegmentTake(projectId, r.takeId);
    expect(a.ok).toBe(true);
    const active = (await listAssetsByType(projectId, 'video')).find((x) => x.shot_number === 1)!;
    expect(active.persistent_url, '重新合成读的是 persistent_url —— 不换等于没采用').toBe(r.videoUrl);
    expect(JSON.parse(active.media_urls || '[]')[0]).toBe(r.videoUrl);
    const d = JSON.parse(active.data || '{}');
    expect(d.duration, '该镜时长不能丢(重新合成会退回默认 8s 之外的值)').toBe(8);
    expect(d.status).toBe('completed');
    expect(d.adoptedSegmentTakeId).toBe(r.takeId);

    const takes = await listSegmentTakes(projectId, 1);
    const orig = takes.find((t) => t.original)!;
    expect(orig, '第一次采用前要记下原片').toBeTruthy();
    expect(orig.videoUrl).toBe(srcUrl);
    expect(takes.find((t) => t.takeId === r.takeId)!.adopted).toBe(true);

    // 再采用一次别的 take 不会重复记原片
    const r2 = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 5, toS: 6 }, { generatePatch: fakeEngine(fx('patch.mp4')).gen });
    expect((await adoptSegmentTake(projectId, r2.takeId)).ok).toBe(true);
    expect((await listSegmentTakes(projectId, 1)).filter((t) => t.original)).toHaveLength(1);
  }, SLOW);

  it('**回退**:采用「原片」→ 活动版恢复成原片地址与原来的 data', async () => {
    const projectId = pid(3);
    const srcUrl = await seedProject(projectId);
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine(fx('patch.mp4')).gen });
    await adoptSegmentTake(projectId, r.takeId);
    const orig = (await listSegmentTakes(projectId, 1)).find((t) => t.original)!;

    expect((await adoptSegmentTake(projectId, orig.takeId)).ok).toBe(true);
    const active = (await listAssetsByType(projectId, 'video')).find((x) => x.shot_number === 1)!;
    expect(active.persistent_url).toBe(srcUrl);
    expect(JSON.parse(active.media_urls || '[]')[0]).toBe(srcUrl);
    const d = JSON.parse(active.data || '{}');
    expect(d).toMatchObject({ duration: 8, status: 'completed', adoptedSegmentTakeId: orig.takeId });
    const takes = await listSegmentTakes(projectId, 1);
    expect(takes.find((t) => t.original)!.adopted).toBe(true);
    expect(takes.find((t) => t.takeId === r.takeId)!.adopted).toBe(false);
  }, SLOW);

  it('引擎全挂回落成占位片 → 默认拒绝、不记 take;联调模式放行但如实标记', async () => {
    const projectId = pid(4);
    await seedProject(projectId);
    const animatic = fakeEngine(fx('patch.mp4'), { isAnimatic: true });
    await expect(runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: animatic.gen }))
      .rejects.toMatchObject({ status: 502 });
    expect(await listSegmentTakes(projectId, 1)).toHaveLength(0);

    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: animatic.gen, allowAnimaticPatch: true });
    expect(r.patchIsAnimatic).toBe(true);
    expect((await listSegmentTakes(projectId, 1))[0].patchIsAnimatic).toBe(true);
    // 采用占位补丁的版本,活动版如实带上占位标记(补渲名单认得出它)
    await adoptSegmentTake(projectId, r.takeId);
    const active = (await listAssetsByType(projectId, 'video')).find((x) => x.shot_number === 1)!;
    expect(JSON.parse(active.data || '{}').isAnimatic).toBe(true);
  }, SLOW);

  it('**补丁画面不够长就不记**:缝合末尾的 fps 会用上一帧填满空档、产物看不出来 → 必须缝合前验,422 不留 take', async () => {
    const projectId = pid(5);
    await seedProject(projectId);
    const e = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine(fx('short.mp4')).gen })
      .catch((x) => x);
    expect(e).toBeInstanceOf(SegmentRetakeError);
    expect(e.status).toBe(422);
    expect(e.message, '要说清补丁画面有多长、需要多长').toMatch(/补丁画面只有 1\.00s,这一段至少需要 2\.00s/);
    expect(await listSegmentTakes(projectId, 1)).toHaveLength(0);
  }, SLOW);

  it('没出过片 / 计划不通过 → 人话错误,不调引擎', async () => {
    const eng = fakeEngine(fx('patch.mp4'));
    await expect(runSegmentRetake({ projectId: pid(6), shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: eng.gen }))
      .rejects.toMatchObject({ status: 409 });
    const projectId = pid(7);
    await seedProject(projectId);
    await expect(runSegmentRetake({ projectId, shotNumber: 1, fromS: 5, toS: 3 }, { generatePatch: eng.gen }))
      .rejects.toMatchObject({ status: 400 });
    expect(eng.calls, '计划不通过就不该花钱').toHaveLength(0);
  }, SLOW);
});

describe.skipIf(!HAS_FFMPEG)('v12.459 · 对抗复查补的三处', () => {
  it('**占位标记跟着这一版画面走**:原片是占位片、只重拍一段 → 仍是占位;整镜换成真补丁 → 不再是占位;回退 → 恢复', async () => {
    const projectId = pid(21);
    await seedProject(projectId, { isAnimatic: true });
    const eng = fakeEngine(fx('patch.mp4'));
    const part = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: eng.gen });
    await adoptSegmentTake(projectId, part.takeId);
    const act = async () => JSON.parse((await listAssetsByType(projectId, 'video')).find((x) => x.shot_number === 1)!.data || '{}');
    expect((await act()).isAnimatic, '其余 6 秒仍是静止图缓推,不能当成已修好').toBe(true);

    const whole = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 0, toS: 8 }, { generatePatch: fakeEngine(fx('patch8.mp4')).gen });
    await adoptSegmentTake(projectId, whole.takeId);
    expect((await act()).isAnimatic, '整镜都换成真画面,补渲名单不该再反复重拍它').toBeUndefined();

    const orig = (await listSegmentTakes(projectId, 1)).find((t) => t.original)!;
    await adoptSegmentTake(projectId, orig.takeId);
    expect((await act()).isAnimatic, '回退到原片,占位标记恢复').toBe(true);
  }, SLOW);

  it('**原片是没打标记的老占位片**(只认得出 qf-animatic- 路径)→ 只重拍一段仍记成占位,不自己另造判据', async () => {
    const projectId = pid(24);
    // 库里实测有 2 条这种:没有 isAnimatic 标记,只能靠我们自己的回落文件名认出来(v12.430)
    fs.copyFileSync(fx('src.mp4'), fx('qf-animatic-1700000000000.mp4'));
    await seedProject(projectId, { srcName: 'qf-animatic-1700000000000.mp4' });
    const part = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine(fx('patch.mp4')).gen });
    await adoptSegmentTake(projectId, part.takeId);
    const active = (await listAssetsByType(projectId, 'video')).find((x) => x.shot_number === 1)!;
    expect(active.persistent_url, '采用后地址已换成缝合产物,路径上的线索没了').toMatch(/segtake-/);
    expect(JSON.parse(active.data || '{}').isAnimatic, '所以标记必须在缝合时就带上').toBe(true);
  }, SLOW);

  it('**原片只有外链(persistent_url 为空)→ 记原片时先落盘**,回退后指向本地副本', async () => {
    const projectId = pid(22);
    await seedProject(projectId, { persistent: false });
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine(fx('patch.mp4')).gen });
    await adoptSegmentTake(projectId, r.takeId);
    const orig = (await listSegmentTakes(projectId, 1)).find((t) => t.original)!;
    const kept = resolveVerifiedServeFilePath(orig.videoUrl)!;
    expect(kept, '原片要落到 seg-retakes 里的本地副本').toContain(`segtake-orig-${projectId}-1-`);
    expect(fs.existsSync(kept)).toBe(true);
    const back = await adoptSegmentTake(projectId, orig.takeId);
    expect(back.ok).toBe(true);
    expect(back.warning).toBeUndefined();
    const active = (await listAssetsByType(projectId, 'video')).find((x) => x.shot_number === 1)!;
    expect(active.persistent_url).toBe(orig.videoUrl);
  }, SLOW);

  it('原片外链落不下来 → 照样记下但标出来,回退时如实提醒可能已过期', async () => {
    const projectId = pid(23);
    await seedProject(projectId);
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine(fx('patch.mp4')).gen });
    // 模拟老项目:活动版只剩一条引擎外链(这里用内网地址 —— safeFetch 必拒,等同于下载失败)
    db.prepare(`UPDATE project_assets SET persistent_url = NULL, media_urls = ? WHERE project_id = ? AND type = 'video'`)
      .run(JSON.stringify(['http://127.0.0.1:1/expired.mp4']), projectId);
    await adoptSegmentTake(projectId, r.takeId);
    const orig = (await listSegmentTakes(projectId, 1)).find((t) => t.original)!;
    expect(orig.videoUrl).toBe('http://127.0.0.1:1/expired.mp4');
    const back = await adoptSegmentTake(projectId, orig.takeId);
    expect(back.ok).toBe(true);
    expect(back.warning).toMatch(/外链.*过期/);
  }, SLOW);
});

describe('v12.459 · 同镜互斥', () => {
  it('同一镜同时两次重拍:后到的拿不到锁;释放后可再拿;不同镜互不影响', () => {
    const u1 = tryLockShot('p-lock', 1);
    expect(u1).toBeTypeOf('function');
    expect(tryLockShot('p-lock', 1)).toBeNull();
    const u2 = tryLockShot('p-lock', 2);
    expect(u2).toBeTypeOf('function');
    u1!(); u2!();
    const again = tryLockShot('p-lock', 1);
    expect(again).toBeTypeOf('function');
    again!();
  });
});
