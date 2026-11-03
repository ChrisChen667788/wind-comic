/**
 * v13.4 · 格式条的「帧率」只是导出时间码的帧基准 —— 修前它写着「升格」,还会把片段重拍弄坏。
 *
 * ── 怎么发现的 ────────────────────────────────────────────────────────
 * v12.466 接通色彩与安全框时留了一条:下拉里 48 / 60 / 120 后面写着「升格」(高帧率拍、放慢播 = 慢动作),
 * 而全仓没有任何代码按它改变拍摄或播放速度。顺着三个读者查下去,问题比两个字大:
 *   ① EDL / AAF 导出:它只是时间码的帧基准。成片在 video-composer 里每镜都过 `fps=24`;
 *      120 一档还会让 EDL 写出 `00:00:00:119` 这种三位帧号(`framesToTimecode` 的帧位是 `frames % fps`),CMX3600 不认;
 *   ② 片段重拍:切点按这个帧率吸附、缝合后按它数帧,**缝合却按原片探测出的帧率出片**。两者不同(格式条 60、原片 24)
 *      → 补丁先花钱生成、再以「补丁素材比需要的短」被拒;格式条留默认 24、而引擎出的是 30fps 原片也一样。
 *
 * 修法:标签改「导出帧率」、去掉「升格」、悬停写明只管 EDL / AAF;去掉 120(旧值回落 24);
 * 片段重拍(预演与真跑)全程用原片真实帧率,不再读这个字段。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 1. 格式条:标签、选项文字、悬停说明;旧资产存的 120 显示为 24;
 * 2. 每一档导出帧率写出的 EDL 时间码都是合法的两位帧号(并自证:120 会写出三位);
 * 3. 悬停里「成片固定 24fps」有代码兜底:video-composer 里写死的帧率只有 24(按 AST 取字面量);
 * 4. 片段重拍真库真 ffmpeg 跑(补丁由本测试现造,不调引擎、不花钱):格式条帧率与原片不同也能成;
 *    预演的切点吸附在原片帧率的栅格上;重拍模块不再读 project-format。
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { execFileSync, spawnSync } from 'node:child_process';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u-v134' })) }));

import { FRAME_RATES } from '@/lib/project-format';
import { buildEDL } from '@/lib/edl-export';
import { resolveFFmpegPath, resolveFFprobePath } from '@/lib/ffmpeg-bin';
import { runSegmentRetake, SEG_RETAKE_MEDIA_KIND, type GeneratePatch } from '@/services/segment-retake-run';
import { createAsset } from '@/lib/repos/asset-repo';
import { serveFilePathUrl, resolveVerifiedServeFilePath } from '@/lib/serve-file-sign';
import { persistentMediaDir } from '@/lib/media-persist';
import { db, now } from '@/lib/db';

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

// v13.13:格式条改叫「成片帧率」、只给 24 / 25 / 30、旧值 48 / 60 / 120 回落 24 —— 这一组移到 tests/v13-13-film-fps

describe('v13.4 · 每一档导出帧率写出的 EDL 时间码都合法', () => {
  /** EDL 里所有时间码的帧位 */
  const frameFields = (edl: string) => [...edl.matchAll(/\b\d{2}:\d{2}:\d{2}:(\d+)\b/g)].map((m) => m[1]);
  // 3.99s 的镜:出点帧位贴着上限(fps - 1 附近)
  const edlAt = (fps: number) => buildEDL([{ name: 'Shot 01', durationS: 3.99 } as never, { name: 'Shot 02', durationS: 2.5 } as never], fps);

  it('自证:120 会写出三位帧号 —— 检测器认得出坏的', () => {
    expect(frameFields(edlAt(120)).some((f) => f.length > 2)).toBe(true);
  });

  for (const fps of FRAME_RATES) {
    it(`${fps}fps:帧位两位且小于帧率`, () => {
      const fields = frameFields(edlAt(fps));
      expect(fields.length, '扫到了时间码').toBeGreaterThan(4);
      for (const f of fields) {
        expect(f).toHaveLength(2);
        expect(Number(f)).toBeLessThan(fps);
      }
    });
  }
});

// v13.13:成片不再固定 24fps(合成按项目成片帧率),「合成器里只有 24」那条移到 tests/v13-13-film-fps 并改成「不写死帧率」

// ── 片段重拍:真库 + 真 ffmpeg(补丁现造,不调引擎) ─────────────────────
const FF = resolveFFmpegPath();
const FP = resolveFFprobePath();
const HAS_FFMPEG = spawnSync(FF, ['-version']).status === 0 && spawnSync(FP, ['-version']).status === 0;
const SLOW = 180_000;
let dir = '';
const fx = (n: string) => path.join(dir, n);
const ff = (args: string[]) => execFileSync(FF, ['-v', 'error', '-y', ...args]);
const PID = `v134-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const pid = (n: number) => {
  const id = `${PID}-${n}`;
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-v134', 'u-v134@t.local', 'x', 't', 'user', ?)`).run(now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, 'u-v134', 'v13.4', 'draft', ?, ?)`).run(id, now(), now());
  return id;
};
const frames = (file: string) => Number(JSON.parse(execFileSync(FP, ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_streams', '-of', 'json', file]).toString()).streams[0].nb_read_frames);

/** 出过片的项目:镜 1 = 8s,活动版视频指向本地原片;formatFps 不传 = 没存过格式(默认 24) */
async function seed(projectId: string, src: string, formatFps?: number) {
  const url = serveFilePathUrl(fx(src));
  await createAsset({ projectId, type: 'timeline', name: 'timeline', data: { timeline: [{ shotNumber: 1, duration: 8 }] } });
  if (formatFps) await createAsset({ projectId, type: 'project-format', name: 'format', data: { colorSpaceId: 'none', fps: formatFps, safeArea: false } });
  await createAsset({ projectId, type: 'video', name: '镜 1', shotNumber: 1, data: { duration: 8, status: 'completed' }, mediaUrls: [url], persistentUrl: url });
  await createAsset({ projectId, type: 'storyboard', name: '分镜 1', shotNumber: 1, data: { description: '雨夜回头' } });
}
function fakeEngine(file: string) {
  const calls: unknown[] = [];
  const gen: GeneratePatch = async (args) => { calls.push(args); return { videoUrl: serveFilePathUrl(fx(file)), isAnimatic: false }; };
  return { gen, calls };
}

beforeAll(() => {
  if (!HAS_FFMPEG) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v134-'));
  const enc = ['-c:v', 'libx264', '-crf', '18', '-g', '48', '-pix_fmt', 'yuv420p'];
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '8', ...enc, fx('src24.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '8', ...enc, fx('src30.mp4')]);
  ff(['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30', '-t', '3', ...enc, fx('patch.mp4')]);
}, SLOW);

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  const md = persistentMediaDir(SEG_RETAKE_MEDIA_KIND);
  for (const f of fs.readdirSync(md)) if (f.includes(PID)) fs.rmSync(path.join(md, f), { force: true });
});

describe.skipIf(!HAS_FFMPEG)('v13.4 · 片段重拍按原片帧率,不读格式条', () => {
  it('**格式条存了 60、原片 24fps:重拍成功,192 帧**(修前补丁先生成、再以帧数对不上 422)', async () => {
    const projectId = pid(1);
    await seed(projectId, 'src24.mp4', 60);
    const eng = fakeEngine('patch.mp4');
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: eng.gen });
    expect(eng.calls).toHaveLength(1);
    expect(frames(resolveVerifiedServeFilePath(r.videoUrl)!)).toBe(192);
    expect(r.plan.totalAfterS).toBe(8);
  }, SLOW);

  it('**没存过格式(默认 24)、引擎出的原片是 30fps:重拍成功,240 帧**', async () => {
    const projectId = pid(2);
    await seed(projectId, 'src30.mp4');
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine('patch.mp4').gen });
    expect(frames(resolveVerifiedServeFilePath(r.videoUrl)!)).toBe(240);
  }, SLOW);

  it('格式条 24、原片 24fps:照常成功(正常侧)', async () => {
    const projectId = pid(3);
    await seed(projectId, 'src24.mp4', 24);
    const r = await runSegmentRetake({ projectId, shotNumber: 1, fromS: 3, toS: 5 }, { generatePatch: fakeEngine('patch.mp4').gen });
    expect(frames(resolveVerifiedServeFilePath(r.videoUrl)!)).toBe(192);
  }, SLOW);

  describe('预演(dryRun)的切点吸附在原片帧率的栅格上', () => {
    async function dryRun(projectId: string, fromS: number) {
      const { POST } = await import('@/app/api/projects/[id]/segment-retake/route');
      const res = await POST(new Request(`http://t/api/projects/${projectId}/segment-retake`, {
        method: 'POST', body: JSON.stringify({ shotNumber: 1, fromS, toS: 4, dryRun: true }),
      }) as never, { params: Promise.resolve({ id: projectId }) });
      expect(res.status).toBe(200);
      return (await res.json()).plan;
    }

    it('**原片 30fps(格式条没存):1.02s 吸到 31/30s**,修前按 24 吸到 1.0s', async () => {
      const projectId = pid(4);
      await seed(projectId, 'src30.mp4');
      expect((await dryRun(projectId, 1.02)).patchFromS).toBeCloseTo(31 / 30, 9);
    }, SLOW);

    it('**原片 24fps、格式条存了 60:1.02s 吸到 1.0s**,修前按 60 吸到 61/60s', async () => {
      const projectId = pid(5);
      await seed(projectId, 'src24.mp4', 60);
      expect((await dryRun(projectId, 1.02)).patchFromS).toBeCloseTo(1, 9);
    }, SLOW);

    it('还没出片(没有视频活动版)、格式条存了 60:按成片帧率 24 吸附,不报错', async () => {
      const projectId = pid(6);
      await createAsset({ projectId, type: 'timeline', name: 'timeline', data: { timeline: [{ shotNumber: 1, duration: 8 }] } });
      await createAsset({ projectId, type: 'project-format', name: 'format', data: { colorSpaceId: 'none', fps: 60, safeArea: false } });
      expect((await dryRun(projectId, 1.02)).patchFromS).toBeCloseTo(1, 9);
    }, SLOW);

    it('原片文件丢了:预演按 24 吸附,不报 500(真跑会如实 409)', async () => {
      const projectId = pid(7);
      await seed(projectId, 'missing.mp4', 60);
      expect((await dryRun(projectId, 1.02)).patchFromS).toBeCloseTo(1, 9);
    }, SLOW);
  });
});

describe('v13.4 · 片段重拍不再读格式条', () => {
  it('重拍模块与路由里没有 project-format 资产读取,也不再导入 normalizeProjectFormat(按 AST)', () => {
    for (const file of ['services/segment-retake-run.ts', 'services/segment-retake.service.ts', 'app/api/projects/[id]/segment-retake/route.ts']) {
      const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const strings: string[] = [];
      const ids: string[] = [];
      const walk = (n: ts.Node) => {
        if (ts.isStringLiteral(n)) strings.push(n.text);
        if (ts.isIdentifier(n)) ids.push(n.text);
        ts.forEachChild(n, walk);
      };
      walk(sf);
      expect(strings, file).not.toContain('project-format');
      expect(ids, file).not.toContain('normalizeProjectFormat');
      expect(ids, file).not.toContain('projectFps');
      expect(ids, file).not.toContain('projectFilmFps');   // v13.13 新的读口:片段重拍同样不许读
    }
    // 窗口自证:导出 EDL 仍然读它(v13.4 时这是它唯一的用处;v13.13 起合成也读,见 v13-13-film-fps)
    const edl = fs.readFileSync('app/api/projects/[id]/export-edl/route.ts', 'utf-8');
    expect(edl).toContain("'project-format'");
  });
});

// v13.13:对外文档那句改为「成片帧率按格式条设置」,断言移到 tests/v13-13-film-fps
