/**
 * v13.8 · ffmpeg / ffprobe 的解析收口到 lib/ffmpeg-bin,FFMPEG_PATH 真的生效。
 *
 * 病根:README 许可证表、modelscope-intro、license-check 都写「改用系统 ffmpeg(设 FFMPEG_PATH)」,
 * 而代码从不读它 —— composer 无条件 setFfmpegPath(连 fluent-ffmpeg 自己对 FFMPEG_PATH 的读取也盖掉),
 * 本地 2D 口型只认 LIPSYNC_FFMPEG_PATH,6 个模块各自 import ffmpeg-static 再 setFfmpegPath
 * (fluent-ffmpeg 的路径是进程级全局,谁最后加载谁说了算),3 个模块按名字直调 ffprobe。
 *
 * 三道:
 *   ① 解析顺序(用临时造的假可执行文件,不依赖本机装了什么);
 *   ② 真跑 —— FFMPEG_PATH / FFPROBE_PATH 指向「记一笔再转给真 ffmpeg」的探针脚本,
 *      先把所有用 ffmpeg 的模块都加载一遍(谁在加载时偷偷改全局路径,探针就收不到),
 *      再从 fluent-ffmpeg、shell 拼命令、execFile、spawn 四种调用方式各打一次,断言探针都收到了;
 *   ③ 静态门禁 lib/consumer-gate 的 `ffmpeg-binary-must-use-ffmpeg-bin`:每种绕过写法都拦得住、正常写法不误报。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { locateFFmpeg, locateFFprobe, resolveFFmpegPath, resolveFFprobePath } from '@/lib/ffmpeg-bin';
import { stripComments, runConsumerGate } from '@/lib/consumer-gate/scan';
import { CONTRACTS } from '@/lib/consumer-gate/contracts';

const BIN_ENV = ['FFMPEG_PATH', 'LIPSYNC_FFMPEG_PATH', 'FFPROBE_PATH', 'FFMPEG_BIN'] as const;
const SAVED: Record<string, string | undefined> = Object.fromEntries([...BIN_ENV, 'PATH'].map((k) => [k, process.env[k]]));
function clearBinEnv(): void {
  for (const k of BIN_ENV) delete process.env[k];
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-8-ffbin-'));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** 造一个假可执行文件(内容无所谓,解析只看「是不是可执行的普通文件」)。 */
function fakeExe(name: string, mode = 0o755): string {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(p, mode);
  return p;
}

const BUNDLED_FFMPEG = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
const BUNDLED_FFPROBE = path.join(process.cwd(), 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe');
const real = (p: string) => fs.realpathSync(p);

describe('v13.8 · 解析顺序:FFMPEG_PATH → LIPSYNC_FFMPEG_PATH → ffmpeg-static → 系统', () => {
  afterEach(() => { restoreEnv(); vi.restoreAllMocks(); });

  it('什么都不设:用随包的 ffmpeg-static —— 正面证明 require 在这里真解析到了,不是被 catch 吞掉后落到系统 ffmpeg', () => {
    clearBinEnv();
    const hit = locateFFmpeg();
    expect(hit?.source).toBe('ffmpeg-static');
    expect(real(hit!.path)).toBe(real(BUNDLED_FFMPEG));
    expect(resolveFFmpegPath()).toBe(hit!.path);
  });

  it('设了 FFMPEG_PATH:用它,压过 LIPSYNC_FFMPEG_PATH 和 ffmpeg-static', () => {
    clearBinEnv();
    const mine = fakeExe('order/ffmpeg-mine');
    process.env.LIPSYNC_FFMPEG_PATH = fakeExe('order/ffmpeg-legacy');
    process.env.FFMPEG_PATH = mine;
    expect(locateFFmpeg()).toEqual({ path: mine, source: 'FFMPEG_PATH' });
    expect(resolveFFmpegPath()).toBe(mine);
  });

  it('只设旧的 LIPSYNC_FFMPEG_PATH:照样生效(兼容),而且不再只管口型', () => {
    clearBinEnv();
    const legacy = fakeExe('order/ffmpeg-legacy-only');
    process.env.LIPSYNC_FFMPEG_PATH = legacy;
    expect(locateFFmpeg()).toEqual({ path: legacy, source: 'LIPSYNC_FFMPEG_PATH' });
  });

  it('FFMPEG_PATH 写成命令名:在 PATH 上找', () => {
    clearBinEnv();
    const p = fakeExe('pathdir/ffmpeg-custom-build');
    process.env.PATH = `${path.dirname(p)}${path.delimiter}${SAVED.PATH || ''}`;
    process.env.FFMPEG_PATH = 'ffmpeg-custom-build';
    expect(locateFFmpeg()).toEqual({ path: p, source: 'FFMPEG_PATH' });
  });

  it('FFMPEG_PATH 写成相对路径:按 cwd 解析', () => {
    clearBinEnv();
    const p = fakeExe('rel/ffmpeg-rel');
    process.env.FFMPEG_PATH = path.relative(process.cwd(), p);
    expect(process.env.FFMPEG_PATH.startsWith('/')).toBe(false);
    expect(locateFFmpeg()).toEqual({ path: p, source: 'FFMPEG_PATH' });
  });

  it.each([
    ['不存在', () => path.join(tmp, 'no-such-dir', 'ffmpeg')],
    ['是目录', () => { const d = path.join(tmp, 'a-dir'); fs.mkdirSync(d, { recursive: true }); return d; }],
    ['没有执行权限', () => fakeExe('noexec/ffmpeg', 0o644)],
  ])('FFMPEG_PATH %s:不静默 —— warn 点名这个变量,再退回 ffmpeg-static', (_label, make) => {
    clearBinEnv();
    const bad = make();
    process.env.FFMPEG_PATH = bad;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hit = locateFFmpeg();
    expect(hit?.source).toBe('ffmpeg-static');
    const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain(`FFMPEG_PATH=${bad}`);
  });

  it('FFMPEG_PATH 是空串或空白:等于没设,不报警', () => {
    clearBinEnv();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const v of ['', '   ']) {
      process.env.FFMPEG_PATH = v;
      expect(locateFFmpeg()?.source).toBe('ffmpeg-static');
    }
    expect(warn.mock.calls.length).toBe(0);
  });

  it('设了 FFPROBE_PATH:ffprobe 用它', () => {
    clearBinEnv();
    const mine = fakeExe('order/ffprobe-mine');
    process.env.FFPROBE_PATH = mine;
    expect(locateFFprobe()).toEqual({ path: mine, source: 'FFPROBE_PATH' });
    expect(resolveFFprobePath()).toBe(mine);
  });

  it('不设 FFPROBE_PATH:这个平台有随包 ffprobe 就用它,没有(如 linux/arm64)就落到系统', () => {
    clearBinEnv();
    const hit = locateFFprobe();
    if (fs.existsSync(BUNDLED_FFPROBE)) {
      expect(hit?.source).toBe('ffprobe-static');
      expect(real(hit!.path)).toBe(real(BUNDLED_FFPROBE));
    } else {
      expect(['PATH', 'system']).toContain(hit?.source);
    }
  });

  it('FFMPEG_PATH 只管 ffmpeg:ffprobe 不会被它带走(两个变量各管各的,文档也这么写)', () => {
    clearBinEnv();
    process.env.FFMPEG_PATH = fakeExe('only-ff/ffmpeg');
    const probe = locateFFprobe();
    expect(probe?.source).not.toBe('FFPROBE_PATH');
    expect(probe?.path).toBeTruthy();
  });
});

/**
 * 探针脚本:把参数记一行,再原样转给真的二进制 —— 产物是真的,所以调用方的成功判定照常生效。
 */
function writeSpy(name: string, tag: string, realBin: string, log: string): string {
  const p = path.join(tmp, 'spy', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "${tag} $*" >> '${log}'\nexec '${realBin}' "$@"\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

describe('v13.8 · 真跑:FFMPEG_PATH / FFPROBE_PATH 指向探针,所有用 ffmpeg 的模块都走它', () => {
  const log = path.join(tmp, 'spy.log');
  let realFf = '';
  let mp4 = '';
  let png = '';
  /** 清空探针记录 → 跑 fn → 返回这次的记录 */
  async function spied(fn: () => Promise<unknown>): Promise<string[]> {
    fs.writeFileSync(log, '');
    await fn();
    return fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean);
  }

  beforeAll(async () => {
    clearBinEnv();
    realFf = locateFFmpeg()!.path;
    const realFp = locateFFprobe()!.path;
    // 夹具用真 ffmpeg 直接造,不经探针
    mp4 = path.join(tmp, 'clip.mp4');
    execFileSync(realFf, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', mp4]);
    png = path.join(tmp, 'frame.png');
    execFileSync(realFf, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', png]);

    process.env.FFMPEG_PATH = writeSpy('ffmpeg', 'FFMPEG', realFf, log);
    process.env.FFPROBE_PATH = writeSpy('ffprobe', 'FFPROBE', realFp, log);
    vi.resetModules();
    await import('@/lib/ffmpeg-bin');
    // 把用 fluent-ffmpeg 的模块全部加载一遍 —— v13.8 之前其中 6 个会在这时把全局路径改回 ffmpeg-static
    await import('@/services/video-composer');
    await import('@/lib/editor-score');
    await import('@/lib/scene-split');
    await import('@/lib/audio-silence');
    await import('@/lib/last-frame-extractor');
    await import('@/lib/audio-health');
    await import('@/lib/beat-detect');
    await import('@/lib/bgm-multi-act');
    await import('@/lib/video-transcode');
    await import('@/services/frame-strip.service');
    await import('@/services/segment-retake.service');
    await import('@/services/intro-outro');
  }, 60_000);

  afterAll(async () => {
    // singleFork:后面的测试文件和本文件共用这个进程,而 fluent-ffmpeg 的路径是进程级全局 —— 设回默认
    restoreEnv();
    vi.resetModules();
    await import('@/lib/ffmpeg-bin');
  });

  it('入口报告的来源是 FFMPEG_PATH / FFPROBE_PATH', async () => {
    const m = await import('@/lib/ffmpeg-bin');
    expect(m.locateFFmpeg()?.source).toBe('FFMPEG_PATH');
    expect(m.locateFFprobe()?.source).toBe('FFPROBE_PATH');
  });

  it('fluent-ffmpeg 出文件(audio-silence):探针收到,产物是真的', async () => {
    const { createSilenceMp3 } = await import('@/lib/audio-silence');
    let out = '';
    const calls = await spied(async () => { out = await createSilenceMp3(0.5, tmp); });
    expect(fs.statSync(out).size).toBeGreaterThan(0);
    expect(calls.some((l) => l.startsWith('FFMPEG ') && l.includes('anullsrc'))).toBe(true);
  });

  it('fluent-ffmpeg 的 ffprobe(composer.probeVideoIntegrity):探针收到', async () => {
    const { probeVideoIntegrity } = await import('@/services/video-composer');
    let r: { ok: boolean; durationSec?: number } = { ok: false };
    const calls = await spied(async () => { r = await probeVideoIntegrity(mp4); });
    expect(r.ok).toBe(true);
    expect(calls.some((l) => l.startsWith('FFPROBE '))).toBe(true);
  });

  it('shell 拼命令(composer.applyTwoPassLoudnorm):探针收到', async () => {
    const { applyTwoPassLoudnorm } = await import('@/services/video-composer');
    const copy = path.join(tmp, 'loud.mp4');
    fs.copyFileSync(mp4, copy);
    const calls = await spied(() => applyTwoPassLoudnorm(copy));
    expect(calls.some((l) => l.startsWith('FFMPEG ') && l.includes('loudnorm'))).toBe(true);
  });

  it('execFile 按路径调(film-health.probeMediaFull,原先按名字直调 ffprobe):探针收到', async () => {
    const { probeMediaFull } = await import('@/lib/film-health');
    let r: { width: number } | null = null;
    const calls = await spied(async () => { r = await probeMediaFull(mp4); });
    expect(r!.width).toBe(320);
    expect(calls.some((l) => l.startsWith('FFPROBE ') && l.includes('-show_streams'))).toBe(true);
  });

  it('spawn(image-signature,原先直接 import ffmpeg-static):探针收到,签名是真算出来的', async () => {
    const { imageSignature, SIGNATURE_DIM } = await import('@/lib/image-signature');
    let sig: number[] | null = null;
    const calls = await spied(async () => { sig = await imageSignature(png); });
    expect(sig!.length).toBe(SIGNATURE_DIM);
    expect(calls.some((l) => l.startsWith('FFMPEG ') && l.includes('rawvideo'))).toBe(true);
  });

  it('零 key 演示的假片(mock-clip,原先借本地口型那份只认 LIPSYNC_FFMPEG_PATH 的解析):探针收到', async () => {
    const { ensureMockClipFile } = await import('@/lib/mock-clip');
    const seed = `${Date.now().toString(16)}abcdef`.slice(-12);
    let file = '';
    const calls = await spied(async () => { file = await ensureMockClipFile(seed, '16:9', 1); });
    try {
      expect(fs.statSync(file).size).toBeGreaterThan(0);
      expect(calls.some((l) => l.startsWith('FFMPEG ') && l.includes('lavfi'))).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

/**
 * 为什么单独一组:fluent-ffmpeg 没被设过路径时,会自己读 FFMPEG_PATH —— 所以上面那组即使入口忘了
 * setFfmpegPath 也照样绿(变异检验实测存活)。它自己不认的是我们顺序里的其余几步:旧的
 * LIPSYNC_FFMPEG_PATH、ffmpeg-static。只设 LIPSYNC_FFMPEG_PATH 时 fluent 也得走它,才证明是入口设的。
 */
describe('v13.8 · 真跑:只设旧的 LIPSYNC_FFMPEG_PATH,fluent-ffmpeg 也走它(证明路径是入口设的,不是 fluent 自己读的)', () => {
  const log = path.join(tmp, 'spy-legacy.log');

  beforeAll(async () => {
    clearBinEnv();
    process.env.LIPSYNC_FFMPEG_PATH = writeSpy('ffmpeg-legacy', 'LEGACY', locateFFmpeg()!.path, log);
    vi.resetModules();
    await import('@/lib/ffmpeg-bin');
  });

  afterAll(async () => {
    restoreEnv();
    vi.resetModules();
    await import('@/lib/ffmpeg-bin');
  });

  it('audio-silence 出静音 mp3:探针收到', async () => {
    fs.writeFileSync(log, '');
    const { createSilenceMp3 } = await import('@/lib/audio-silence');
    const out = await createSilenceMp3(0.5, tmp);
    expect(fs.statSync(out).size).toBeGreaterThan(0);
    const calls = fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean);
    expect(calls.some((l) => l.startsWith('LEGACY ') && l.includes('anullsrc'))).toBe(true);
  });
});

describe('v13.8 · 静态门禁:除 lib/ffmpeg-bin 外不许自己解析二进制', () => {
  const contract = CONTRACTS.find((c) => c.id === 'ffmpeg-binary-must-use-ffmpeg-bin')!;
  const hits = (line: string) => new RegExp(contract.forbid.source, contract.forbid.flags.replace('g', '')).test(stripComments(line));

  it('契约在表里,入口本体是白名单里的第一条', () => {
    expect(contract.entry).toContain('lib/ffmpeg-bin');
    expect(contract.allow[0].file).toBe('lib/ffmpeg-bin.ts');
    expect(contract.scope).toEqual(expect.arrayContaining(['app/', 'lib/', 'services/']));
  });

  it.each([
    "import ffmpegPath from 'ffmpeg-static';",
    "const p = require('ffmpeg-static');",
    "const pkg = require.resolve('ffmpeg-static/package.json');",
    "const s = require('ffprobe-static');",
    "import ffmpeg from 'fluent-ffmpeg';",
    "const f = (await import(\"fluent-ffmpeg\")).default;",
    "ffmpeg.setFfmpegPath(p);",
    "ffmpeg.setFfprobePath(p);",
    "const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', src]);",
    "const bin = (ffmpegPath as unknown as string) || 'ffmpeg';",
    "spawn(\"ffmpeg\", args);",
    "await sh(`ffmpeg -y -i ${a} ${b}`);",
    "const sys = execSync('which ffprobe 2>/dev/null || where ffprobe 2>nul');",
    "const c = ['/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg'];",
    "const g = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');",
    "const bin = process.env.LIPSYNC_FFMPEG_PATH;",
    "if (process.env.FFMPEG_PATH) use(process.env.FFMPEG_PATH);",
  ])('拦得住:%s', (line) => {
    expect(hits(line)).toBe(true);
  });

  it.each([
    "import { ffmpeg, resolveFFmpegPath } from '@/lib/ffmpeg-bin';",
    "const { resolveFFmpegPath } = await import('./ffmpeg-bin');",
    "const bin = locateFFmpeg()?.path;",
    "throw new Error('ffmpeg 不可用(FFMPEG_PATH / ffmpeg-static / 系统 ffmpeg 都没找到)');",
    "// 原先这里 import ffmpegPath from 'ffmpeg-static' 再 setFfmpegPath(p) —— 解释病根的注释不算",
    "await sh(`\"${ff}\" -y -v error -i \"${a}\" \"${b}\"`);",
    "label: 'ffmpeg 合成',",
  ])('不误报:%s', (line) => {
    expect(hits(line)).toBe(false);
  });

  it('全仓扫描:这条契约零违规;且扫描不是空跑 —— 入口本体自己就含被禁写法,只是被白名单放过', () => {
    const entrySrc = stripComments(fs.readFileSync('lib/ffmpeg-bin.ts', 'utf-8')).split('\n');
    const selfHits = entrySrc.filter((l) => hits(l));
    expect(selfHits.length).toBeGreaterThan(2);
    const mine = runConsumerGate(process.cwd()).filter((v) => v.contractId === contract.id);
    expect(mine.map((v) => `${v.file}:${v.line} ${v.snippet}`)).toEqual([]);
  });
});

describe('v13.8 · 文档说的 = 代码做的', () => {
  const read = (f: string) => fs.readFileSync(f, 'utf-8');
  const ENTRY = read('lib/ffmpeg-bin.ts');
  /** 入口真正读的变量 —— 从代码里取,不手抄 */
  const vars = [...new Set([...ENTRY.matchAll(/process\.env\.([A-Z_]+_PATH)\b/g)].map((m) => m[1]))];
  const DEPLOY = read('docs/DEPLOYMENT.md');
  const sec7 = DEPLOY.slice(DEPLOY.indexOf('## 7. ffmpeg 用途清单'), DEPLOY.indexOf('## 8. data/ 目录布局'));

  it('入口读的每个变量,DEPLOYMENT.md §7 都写了、.env.example 都有声明行', () => {
    expect(vars.sort()).toEqual(['FFMPEG_PATH', 'FFPROBE_PATH', 'LIPSYNC_FFMPEG_PATH']);
    expect(sec7.length, '窗口自证:§7 没切到').toBeGreaterThan(500);
    const example = read('.env.example');
    for (const v of vars) {
      expect(sec7, `§7 没写 ${v}`).toContain(`\`${v}\``);
      expect(new RegExp(`^#?\\s*${v}=`, 'm').test(example), `.env.example 没有 ${v}= 声明行`).toBe(true);
    }
  });

  it('§7 写的解析顺序与代码一致(FFMPEG_PATH → LIPSYNC_FFMPEG_PATH → ffmpeg-static → PATH)', () => {
    const body = ENTRY.slice(ENTRY.indexOf('export function locateFFmpeg'), ENTRY.indexOf('export function locateFFprobe'));
    const codeOrder = [...body.matchAll(/source: '([^']+)'/g)].map((m) => m[1]);
    expect(codeOrder).toEqual(['FFMPEG_PATH', 'LIPSYNC_FFMPEG_PATH', 'ffmpeg-static']);
    const first = sec7.split('\n').find((l) => l.startsWith('- 解析顺序')) || '';
    const pos = ['`FFMPEG_PATH`', '`LIPSYNC_FFMPEG_PATH`', '`ffmpeg-static`', 'PATH 上的'].map((t) => first.indexOf(t));
    expect(pos.every((p) => p >= 0), `§7 第一条:${first.slice(0, 80)}`).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('README 许可证表:不再只说「设 FFMPEG_PATH」—— 写明只设变量不会把随包二进制拿出去,并登记 ffprobe-static', () => {
    const README = read('README.md');
    const row = README.split('\n').find((l) => l.startsWith('| `ffmpeg-static` |')) || '';
    expect(row).toContain('FFPROBE_PATH');
    expect(row).toContain('node_modules/ffmpeg-static/ffmpeg');
    expect(row).toContain('node_modules/ffprobe-static/bin');
    expect(row).toMatch(/does \*\*not\*\* take the files out/);
    expect(README.split('\n').some((l) => l.startsWith('| `ffprobe-static` |') && l.includes('--enable-gpl'))).toBe(true);
    const why = read('scripts/license-check.mjs');
    expect(why).toContain('FFPROBE_PATH');
    expect(why).toContain('只设变量不会把文件从包里拿掉');
  });

  it('镜像冒烟证明应用真用了 FFMPEG_PATH(日志那行由入口打),CI 的 drawtext 检查也查 $FFMPEG_PATH', () => {
    const smoke = read('scripts/docker-demo-smoke.sh');
    expect(smoke).toContain('[FFmpeg] Using binary: $WANT (from FFMPEG_PATH)');
    expect(ENTRY).toContain('console.log(`[FFmpeg] Using binary: ${ff ? `${ff.path} (from ${ff.source})`');
    const wf = read('.github/workflows/docker-image.yml');
    expect(wf).toContain(`'"$FFMPEG_PATH" -hide_banner -filters`);
    expect(wf.includes('node_modules/ffmpeg-static/ffmpeg -hide_banner')).toBe(false);
  });
});

describe('v13.8 · 冒烟脚本查日志不能用 `docker logs | grep -q`(pipefail 下命中会被当成没命中)', () => {
  it('⑤⑥ 都对落盘的日志文件 grep;脚本里没有把 docker logs 管道接给 grep -q 的写法', () => {
    const smoke = fs.readFileSync('scripts/docker-demo-smoke.sh', 'utf-8');
    const code = smoke.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.length, '窗口自证').toBeGreaterThan(40);
    expect(smoke).toMatch(/set -euo pipefail/);
    expect(code.some((l) => /docker logs "\$CONTAINER" > "\$WORK\/container\.log" 2>&1/.test(l))).toBe(true);
    expect(code.filter((l) => /docker logs[^|]*\|\s*grep\s+-[a-zA-Z]*q/.test(l))).toEqual([]);
    expect(code.filter((l) => /grep -q[F]? .*"\$WORK\/container\.log"/.test(l)).length).toBeGreaterThanOrEqual(2);
  });
});
