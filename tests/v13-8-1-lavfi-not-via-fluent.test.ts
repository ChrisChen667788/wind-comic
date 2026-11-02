/**
 * v13.8.1 · 用 `-f lavfi` 造输入(静音、纯色)的命令不能走 fluent-ffmpeg。
 *
 * 病象:v13.8 推上 main 后 CI 红在 tests/v13-8 的「audio-silence 出静音 mp3」——
 * 「Input format lavfi is not available」。fluent-ffmpeg 执行前拿 `ffmpeg -formats` 校验每个输入的 `-f`,
 * 而 ffmpeg 7+ 的输出多了一列「是否设备」:
 *   6.0(macOS 的 ffmpeg-static):` D  lavfi           Libavfilter virtual input device`
 *   7.0.2 / 8.0.1(CI、官方镜像):  ` D d lavfi           Libavfilter virtual input device`
 * fluent-ffmpeg 2.1.3 的 formatRegexp 只认两列,把后者读成名叫 `d` 的格式。`.inputFormat('lavfi')` 和
 * `.inputOptions(['-f', 'lavfi'])` 都过这道校验。于是在所有 Linux 部署上:
 *   - lib/audio-silence 的静音 mp3 直接失败;
 *   - lib/audio-health 的「成片没音轨就补一条静音」**静默**失败(catch 里返回原路径),从没生效过;
 *   - services/video-composer 的 Ken Burns 占位片(视频引擎失败 / 没配视频 key 时的兜底)出不来。
 * 本机(macOS 6.0)永远复现不了;用 Linux 静态版 ffmpeg 实测三处修前全失败、修后全通过。
 * 修法:这三处改用 lib/ffmpeg-bin 的 runFfmpeg(参数数组直接 execFile,不经 fluent 的格式校验)。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveFFmpegPath, runFfmpeg } from '@/lib/ffmpeg-bin';

/** 剥掉注释再扫 —— 注释里讲病因时会写到 inputFormat('lavfi'),不能让它满足或绊倒断言 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sourceFiles(): string[] {
  const files = execFileSync('git', ['ls-files', 'app', 'lib', 'services', 'components', 'scripts'], { encoding: 'utf-8' })
    .split('\n').filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
  expect(files.length, '窗口自证:一个源文件都没扫到?').toBeGreaterThan(200);
  return files;
}

describe('v13.8.1 · 源码里不许经 fluent-ffmpeg 传 -f lavfi', () => {
  it('没有 .inputFormat(\'lavfi\'),也没有 inputOptions 里的 -f lavfi', () => {
    const hits: string[] = [];
    for (const f of sourceFiles()) {
      const code = stripComments(fs.readFileSync(f, 'utf-8'));
      if (/\.inputFormat\(\s*['"`]lavfi['"`]\s*\)/.test(code)) hits.push(`${f}: .inputFormat('lavfi')`);
      for (const m of code.matchAll(/\.inputOptions\(\s*(\[[^\]]*\]|[^)]*)\)/g)) {
        if (/['"`]-f['"`]\s*,\s*['"`]lavfi['"`]|['"`]-f\s+lavfi['"`]/.test(m[1])) hits.push(`${f}: .inputOptions(${m[1].slice(0, 40)}…)`);
      }
    }
    expect(hits, 'ffmpeg 7+ 上 fluent 会报 Input format lavfi is not available —— 改用 lib/ffmpeg-bin 的 runFfmpeg').toEqual([]);
  });

  it('三处病根都改走 runFfmpeg', () => {
    for (const f of ['lib/audio-silence.ts', 'lib/audio-health.ts', 'services/video-composer.ts']) {
      expect(stripComments(fs.readFileSync(f, 'utf-8')), f).toMatch(/runFfmpeg\(\s*\[/);
    }
  });
});

// ── 真跑:本机是 ffmpeg-static 6.0,CI 上是 Linux 的 7.0.2(正是会炸的那个) ─────────────────────
const FF = resolveFFmpegPath();
let dir = '';
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-8-1-')); });
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe('v13.8.1 · 真跑(CI 上即 ffmpeg 7.0.2)', () => {
  it('ensureAudioStream:没有音轨的成片补上一条静音轨(修前在 Linux 上静默返回原文件)', async () => {
    const noAudio = path.join(dir, 'noaudio.mp4');
    execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24', '-t', '1', '-pix_fmt', 'yuv420p', noAudio]);
    const { ensureAudioStream, probeAudioStream } = await import('@/lib/audio-health');
    expect(await probeAudioStream(noAudio), '窗口自证:夹具本来就没有音轨').toBe(false);
    const r = await ensureAudioStream(noAudio);
    expect(r.healed).toBe(true);
    expect(r.path).not.toBe(noAudio);
    expect(await probeAudioStream(r.path)).toBe(true);
  }, 60_000);

  it('stillFrameToVideo:分镜图做出带静音轨的 Ken Burns 占位片(修前在 Linux 上直接失败)', async () => {
    const png = path.join(dir, 'still.png');
    execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x336699:s=320x180', '-frames:v', '1', png]);
    const { stillFrameToVideo, probeVideoIntegrity } = await import('@/services/video-composer');
    const out = await stillFrameToVideo(png, 2, dir, 'in', { w: 320, h: 180 });
    const p = await probeVideoIntegrity(out);
    expect(p.ok, p.reason).toBe(true);
    expect(p.hasAudio).toBe(true);
    expect([p.width, p.height]).toEqual([320, 180]);
    expect(Math.abs((p.durationSec ?? 0) - 2)).toBeLessThan(0.3);
  }, 120_000);

  it('runFfmpeg 失败时把 ffmpeg 自己的报错带出来(调用方据此记日志、走降级)', async () => {
    await expect(runFfmpeg(['-y', '-f', 'lavfi', '-i', 'no_such_source_v1381', '-t', '1', path.join(dir, 'x.mp4')]))
      .rejects.toThrow(/ffmpeg 失败.*no_such_source_v1381|ffmpeg 失败.*(No such filter|Invalid argument|not found)/i);
  });
});
