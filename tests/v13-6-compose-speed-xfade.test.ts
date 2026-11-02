/**
 * v13.6 · 有一镜被调速,整片合成就失败(只剩全硬切 concat 兜底)。
 *
 * 病象(v13.1 官方镜像 + docker-compose.demo.yml 实测):零 key 演示每次都合成失败,
 * 日志只有「ffmpeg exited with code 234 … Conversion failed!」,data/composed/ 里留下 0 字节的 final-*.mp4。
 * 当时以为是 mock 素材在 localhost 被 SSRF 拦了 —— 不是:合成器自己的 downloadFile 不经过 SSRF 守卫,
 * 被拦的只是素材入库和尾帧提取两条旁路。真正的报错在 stderr 前面:
 *   [Parsed_xfade] First input link main frame rate (24/1) do not match the corresponding
 *   second input link xfade frame rate (1/0)
 * 第 2 镜被判成「低张力过渡段」加速 1.15×,`setpts=0.870*PTS` 放在 `fps=24` 之后 ——
 * ffmpeg 7.0.x 把它的输出帧率标成未知,xfade 拒收。真引擎成片同样会撞(高光慢放 0.7/0.85 也是 setpts)。
 *
 * 为什么本机一直绿:macOS 上的 ffmpeg-static 是 6.0、Homebrew 是 8.1,都放行;
 * Linux 上的 ffmpeg-static 是 7.0.2(CI、官方镜像里随包的那份)。同一类病 v12.456.1 出过一次。
 * 所以和那次一样两道:不依赖 ffmpeg 构建的结构断言 + 真跑一次合成(CI 上真跑的正是会炸的 7.0.2)。
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveFFmpegPath } from '@/lib/ffmpeg-bin';
import {
  composeVideo,
  probeVideoIntegrity,
  speedChangeFilter,
  ffmpegErrorDigest,
  removeFailedOutput,
  COMPOSE_FPS,
} from '@/services/video-composer';

const SRC = fs.readFileSync('services/video-composer.ts', 'utf-8');
/** 剥掉注释再做结构断言 —— 注释里讲病因时会写到 setpts,不能让它满足或绊倒断言 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('v13.6 · 变速片段必须把帧率钉回恒定值', () => {
  it('speedChangeFilter:setpts 之后紧跟 fps,帧率用调用方给的', () => {
    expect(speedChangeFilter('0.870*PTS', COMPOSE_FPS)).toBe(`,setpts=0.870*PTS,fps=${COMPOSE_FPS}`);
    expect(speedChangeFilter('0.870*PTS', 30), '成片 30fps 时补的也必须是 30').toBe(',setpts=0.870*PTS,fps=30');
    // 速度曲线(分段 setpts 表达式)同样要补
    expect(speedChangeFilter('if(lt(T,2),PTS,1.6*PTS)', 24)).toMatch(/,setpts=if\(lt\(T,2\),PTS,1\.6\*PTS\),fps=24$/);
  });

  it('每条路径里,变速片段补的帧率与画布链的帧率是同一个值(不能各写各的)', () => {
    // 画布链:`${canvasFit},fps=<X>,setsar=1`;变速:speedChangeFilter(…, <Y>) —— 同一条路径里 X 与 Y 必须字面相同
    const canvas = [...CODE.matchAll(/\$\{canvasFit\},fps=\$\{([A-Za-z_][\w.]*)\},setsar=1/g)].map((m) => m[1]);
    const speed = [...CODE.matchAll(/speedChangeFilter\([^;]*?,\s*([A-Za-z_][\w.]*)\)/g)].map((m) => m[1]);
    expect(canvas.length, '窗口自证:单镜 + 多镜两条画布链').toBe(2);
    expect(speed.length, '两处变速调用都必须显式传帧率').toBe(2);
    expect(new Set([...canvas, ...speed]).size, `画布链 ${canvas.join('/')} 与变速 ${speed.join('/')} 用了不同的帧率`).toBe(1);
    expect(CODE, '画布链不许再写死数字帧率').not.toMatch(/\$\{canvasFit\},fps=\d/);
  });

  it('单镜与多镜两条路径都走 speedChangeFilter,源码里没有别的「变速 setpts」', () => {
    expect((CODE.match(/speedChangeFilter\(/g) || []).length, '两条路径各一处').toBeGreaterThanOrEqual(2);
    // 剩下的 setpts 只能是重置时间戳的 PTS-STARTPTS(trim 之后那一步),以及 speedChangeFilter 自己
    const raw = [...CODE.matchAll(/setpts=\$\{?([^`,\]]*)/g)].map((m) => m[1]);
    expect(raw.length, '窗口自证:一处 setpts 都没找到?').toBeGreaterThan(0);
    for (const r of raw) {
      expect(r === 'setptsExpr}' || r.startsWith('PTS-STARTPTS'), `出现了不经 speedChangeFilter 的变速:setpts=${r}`).toBe(true);
    }
  });

  it('ffmpegErrorDigest:从真实 stderr 里挑出病因那几行,丢掉进度行', () => {
    // v13.1 镜像里实际打出来的 stderr(节选)
    const stderr = [
      'Press [q] to stop, [?] for help',
      '[Parsed_xfade_37 @ 0xe915ec04f540] First input link main frame rate (24/1) do not match the corresponding second input link xfade frame rate (1/0)',
      '[Parsed_xfade_37 @ 0xe915ec04f540] Failed to configure output pad on Parsed_xfade_37',
      '[fc#0 @ 0x3ea59f20] Error reinitializing filters!',
      'frame=    0 fps=0.0 q=0.0 Lsize=       0KiB time=N/A bitrate=N/A speed=N/A    ',
      'Conversion failed!',
    ].join('\n');
    const d = ffmpegErrorDigest(stderr);
    expect(d).toContain('xfade frame rate (1/0)');
    expect(d).toContain('Failed to configure output pad');
    expect(d).not.toContain('frame=    0');
    expect(ffmpegErrorDigest(undefined)).toBe('');
  });

  it('removeFailedOutput 真的删掉残留的 0 字节成片;文件不存在时不抛(上面那条只看出口里调没调它)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-6-rm-'));
    try {
      const leftover = path.join(d, 'final-1.mp4');
      fs.writeFileSync(leftover, '');
      removeFailedOutput(leftover);
      expect(fs.existsSync(leftover), '0 字节的 final-*.mp4 还在 —— 看上去像成片').toBe(false);
      expect(() => removeFailedOutput(leftover)).not.toThrow();
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('合成失败的两个出口(单镜 / 多镜)都删残留输出、都打 stderr 病因行', () => {
    const handlers = [...CODE.matchAll(/\.on\('error',\s*\(err, _stdout, stderr\)\s*=>\s*\{([\s\S]{0,600}?)\n\s*\}\)/g)].map((m) => m[1]);
    expect(handlers.length, '单镜 + 多镜两个 error 出口').toBeGreaterThanOrEqual(2);
    for (const h of handlers) {
      expect(h).toContain('removeFailedOutput(outputPath)');
      expect(h).toContain('ffmpegErrorDigest(stderr)');
    }
  });
});

describe('v13.6 · 真跑:四镜、其中一镜被调速,必须走完整合成(不是 concat 兜底)', () => {
  const ff = resolveFFmpegPath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-6-compose-'));
  const produced: string[] = [];
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const p of produced) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
  });

  it('输出 final-*.mp4,时长对得上,被调速那一镜的成片时长确实变了', async () => {
    // 夹具照着零 key 演示那次的时间线造:4 镜、源片 4s、设计 8s、首镜无转场、其余 cut
    const colors = ['32a17a', 'add6b4', 'd2511a', '47dec0'];
    const tension = [3, 5, 5, 4];
    const clips = colors.map((c, i) => {
      const p = path.join(dir, `clip-${i}.mp4`);
      execFileSync(ff, [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=0x${c}:s=320x180:d=4:r=24`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p,
      ]);
      return {
        shotNumber: i + 1, videoUrl: p, duration: 8, transition: i === 0 ? '' : 'cut',
        emotionTemperature: 0, tensionLevel: tension[i], dialogue: '',
      };
    });

    const r = await composeVideo({ clips, aspect: '16:9' });
    produced.push(r.outputPath);
    expect(path.basename(r.outputPath)).toMatch(/^final-\d+\.mp4$/);
    expect(fs.statSync(r.outputPath).size, '0 字节 = 合成失败').toBeGreaterThan(10_000);

    // 窗口自证:这条用例必须真的经过了变速分支,否则它证明不了任何事
    const changed = (r.renderedDurations || []).filter((d) => Math.abs(d.durationS - 4) > 0.2);
    expect(changed.length, '没有任何一镜被调速 —— 夹具没触发变速分支').toBeGreaterThan(0);

    const probe = await probeVideoIntegrity(r.outputPath);
    expect(probe.ok, `成片探测失败:${probe.reason}`).toBe(true);
    expect(probe.width).toBe(1280);
    expect(probe.height).toBe(720);
    expect(probe.hasAudio, '成片应带音轨').toBe(true);
    // 4 镜 × 源片 4s,减去转场重叠、加上调速变化 —— 量级必须对(concat 兜底不会走到这里,但时长坍成 0 也算失败)
    expect(probe.durationSec!).toBeGreaterThan(10);
    expect(probe.durationSec!).toBeLessThan(18);
    expect(Math.abs(probe.durationSec! - r.totalDuration), '回传的 totalDuration 与成片实际时长对不上').toBeLessThan(1);
  }, 120_000);
});
