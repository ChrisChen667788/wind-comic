/**
 * v12.456 — 片段重拍的执行层**真跑 ffmpeg**。v12.315 那组只做了静态断言,两个病都从缝里漏了过去:
 *
 * ① **「保留段是字节拷贝、零损失」是假的。** 切片没带 `-c copy`,按 x264 默认 crf 23 重编码了一遍;
 *    测试只锁了最后 concat 那一步的 `-c copy`,于是一直是绿的。
 *    字节拷贝本身也做不到(`-c copy` 只能切在关键帧上,会破坏总时长不变量),
 *    所以现在改成「一趟解码 → 一次 crf 17 编码」,这里用 **PSNR** 锁住「高质量」这件事本身,
 *    而不是锁某个参数字面量 —— 参数改了、质量没掉,测试不该红;质量掉了,参数再像样也得红。
 *
 * ② **补丁段变调。** 补丁音频被硬写成 44100/2,而 concat demuxer 按第一段(原片 48000)声明整条轨,
 *    880Hz 的补丁播出来是 960Hz。这里用过零率直接量音高,并检查整条音轨的参数与原片一致。
 *
 * 夹具全部现场生成:原片 8s / 24fps / 关键帧每 2s 一个(切点 3s、5s 都**不**在关键帧上)/
 * 48kHz 单声道 440Hz;补丁模仿引擎产出 —— 3s(引擎下限)/ 30fps / 分辨率不同 / 44.1kHz 立体声 880Hz。
 * ffmpeg 与服务用同一个(composer 的解析口径);本机跑不起来就整组跳过。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveFFmpegPath, resolveFFprobePath } from '@/services/video-composer';
import { planAndExecute } from '@/services/segment-retake.service';

const FF = resolveFFmpegPath();
const FP = resolveFFprobePath();
const runnable = (bin: string) => spawnSync(bin, ['-version']).status === 0;
const HAS_FFMPEG = runnable(FF) && runnable(FP);

const FPS = 24;
const FRAME = 1 / FPS;
const SLOW = 120_000;

let dir = '';
const fx = (name: string) => path.join(dir, name);
const ff = (args: string[]) => execFileSync(FF, ['-v', 'error', '-y', ...args]);

function probe(file: string): { streams: any[]; format: any } {
  return JSON.parse(execFileSync(FP, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).toString());
}

/** 一段 PCM(统一解到 48k 单声道) */
function pcm(file: string, fromS: number, toS: number): Int16Array {
  const raw = execFileSync(FF, ['-v', 'error', '-i', file, '-map', '0:a:0',
    '-af', `atrim=start=${fromS}:end=${toS}`, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
  return new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
}

/** 纯音的频率 ≈ 过零次数 / 2 / 秒数 */
function toneHz(file: string, fromS: number, toS: number): number {
  const s = pcm(file, fromS, toS);
  let zc = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) zc++;
  return zc / 2 / (s.length / 48000);
}

function rms(file: string, fromS: number, toS: number): number {
  const s = pcm(file, fromS, toS);
  let acc = 0;
  for (const v of s) acc += v * v;
  return Math.sqrt(acc / Math.max(1, s.length));
}

/** 输出与原片同一区间的亮度+色度平均 PSNR */
function psnr(out: string, src: string, fromS: number, toS: number): number {
  const w = `trim=start=${fromS}:end=${toS},setpts=PTS-STARTPTS`;
  const r = spawnSync(FF, ['-hide_banner', '-i', out, '-i', src, '-filter_complex',
    `[0:v]${w}[a];[1:v]${w}[b];[a][b]psnr`, '-f', 'null', '-'], { encoding: 'utf-8' });
  const m = /PSNR .*average:([\d.]+|inf)/.exec(r.stderr || '');
  if (!m) throw new Error(`psnr 没量出来:${(r.stderr || '').slice(-300)}`);
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

const retake = (sourcePath: string, patchPath: string, fromS = 3, toS = 5) =>
  planAndExecute({
    shotDurationS: 8, fromS, toS, fps: FPS, engineMinDurationS: 3,
    sourcePath, patchPath, outputDir: fs.mkdtempSync(path.join(dir, 'out-')),
  });

describe.skipIf(!HAS_FFMPEG)('v12.456 · 片段重拍真跑 ffmpeg', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v12456-'));
    const video = ['-c:v', 'libx264', '-crf', '12', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-pix_fmt', 'yuv420p'];
    // 带时域噪声:画质掉一档 PSNR 就看得出来(纯 testsrc2 太好压,crf 17 和 23 分不开)
    const srcVideo = ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24,noise=alls=12:allf=t'];
    ff([...srcVideo, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '8', ...video, '-c:a', 'aac', '-ac', '1', '-ar', '48000', fx('src.mp4')]);
    ff([...srcVideo, '-t', '8', ...video, fx('src-silent.mp4')]);
    const patchVideo = ['-f', 'lavfi', '-i', 'smptebars=size=480x270:rate=30'];
    ff([...patchVideo, '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-ar', '44100', fx('patch.mp4')]);
    ff([...patchVideo, '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fx('patch-silent.mp4')]);
  }, SLOW);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('缝合后时长 === plan.totalAfterS(一帧以内),帧数一帧不差', async () => {
    const r = await retake(fx('src.mp4'), fx('patch.mp4'));
    expect(r.plan.head, '夹具要覆盖 head + patch + tail 三段').not.toBeNull();
    expect(r.plan.tail).not.toBeNull();
    expect(Math.abs(r.measuredDurationS - r.plan.totalAfterS)).toBeLessThan(FRAME);
    const v = probe(r.outputPath).streams.find((s) => s.codec_type === 'video');
    expect(Number(v.nb_read_frames)).toBe(r.plan.totalAfterS * FPS);
    expect(v.avg_frame_rate, '帧率跟原片').toBe('24/1');
    expect([v.width, v.height], '补丁按原片分辨率归一').toEqual([320, 180]);
  }, SLOW);

  it('整条音轨按原片参数:48kHz 单声道 aac,且只有一条', async () => {
    const r = await retake(fx('src.mp4'), fx('patch.mp4'));
    const audio = probe(r.outputPath).streams.filter((s) => s.codec_type === 'audio');
    expect(audio).toHaveLength(1);
    expect(audio[0].codec_name).toBe('aac');
    expect(Number(audio[0].sample_rate), '不是硬写的 44100').toBe(48000);
    expect(Number(audio[0].channels), '不是硬写的双声道').toBe(1);
    expect(Math.abs(Number(audio[0].duration) - r.plan.totalAfterS)).toBeLessThan(FRAME);
  }, SLOW);

  it('**补丁段不变调**:880Hz 仍是 880Hz,前后段仍是 440Hz(修前补丁量出来 960Hz)', async () => {
    const r = await retake(fx('src.mp4'), fx('patch.mp4'));
    // 各段离接缝留 0.2s,只量稳态
    expect(toneHz(r.outputPath, 0.5, 2.8)).toBeCloseTo(440, -1);
    expect(toneHz(r.outputPath, 3.2, 4.8)).toBeGreaterThan(880 * 0.985);
    expect(toneHz(r.outputPath, 3.2, 4.8)).toBeLessThan(880 * 1.015);
    expect(toneHz(r.outputPath, 5.2, 7.8), '后段没被补丁挤偏').toBeCloseTo(440, -1);
  }, SLOW);

  it('**保留段高质量**:前后段对原片 PSNR ≥ 36dB(x264 默认档在这个夹具上只有 ~32.5dB)', async () => {
    const r = await retake(fx('src.mp4'), fx('patch.mp4'));
    expect(psnr(r.outputPath, fx('src.mp4'), 0, 3)).toBeGreaterThanOrEqual(36);
    expect(psnr(r.outputPath, fx('src.mp4'), 5, 8), '后段同样不能被拖到默认画质').toBeGreaterThanOrEqual(36);
  }, SLOW);

  it('补丁没有音轨:补同长静音,音轨不断,后段不被挤偏', async () => {
    const r = await retake(fx('src.mp4'), fx('patch-silent.mp4'));
    const audio = probe(r.outputPath).streams.filter((s) => s.codec_type === 'audio');
    expect(audio).toHaveLength(1);
    expect(Number(audio[0].sample_rate)).toBe(48000);
    expect(rms(r.outputPath, 3.1, 4.9), '补丁那两秒是静音').toBeLessThan(50);
    expect(rms(r.outputPath, 0.5, 2.8), '对照:前段有声').toBeGreaterThan(1000);
    expect(toneHz(r.outputPath, 5.2, 7.8)).toBeCloseTo(440, -1);
    expect(Math.abs(r.measuredDurationS - r.plan.totalAfterS)).toBeLessThan(FRAME);
  }, SLOW);

  it('原片没有音轨:输出也不带,补丁自带的声音不塞进来', async () => {
    const r = await retake(fx('src-silent.mp4'), fx('patch.mp4'));
    const streams = probe(r.outputPath).streams;
    expect(streams.filter((s) => s.codec_type === 'video')).toHaveLength(1);
    expect(streams.filter((s) => s.codec_type === 'audio')).toHaveLength(0);
    expect(Math.abs(r.measuredDurationS - r.plan.totalAfterS)).toBeLessThan(FRAME);
  }, SLOW);

  it('从头重拍(没有 head)与拍到尾(没有 tail):两段也拼得准', async () => {
    const a = await retake(fx('src.mp4'), fx('patch.mp4'), 0, 2);
    expect(a.plan.head).toBeNull();
    expect(Math.abs(a.measuredDurationS - a.plan.totalAfterS)).toBeLessThan(FRAME);
    expect(toneHz(a.outputPath, 0.2, 1.8)).toBeGreaterThan(880 * 0.985);

    const b = await retake(fx('src.mp4'), fx('patch.mp4'), 6, 8);
    expect(b.plan.tail).toBeNull();
    expect(Math.abs(b.measuredDurationS - b.plan.totalAfterS)).toBeLessThan(FRAME);
    expect(toneHz(b.outputPath, 6.2, 7.8)).toBeLessThan(880 * 1.015);
    expect(toneHz(b.outputPath, 6.2, 7.8)).toBeGreaterThan(880 * 0.985);
  }, SLOW);
});
