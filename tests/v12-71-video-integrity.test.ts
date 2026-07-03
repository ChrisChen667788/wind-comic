/**
 * v12.71 — 视频完整性校验:真 ffprobe 验好片/坏片/垃圾文件。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { probeVideoIntegrity } from '@/services/video-composer';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FF = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-'));
const goodMp4 = path.join(tmp, 'good.mp4');
const junkMp4 = path.join(tmp, 'junk.mp4');
const tinyMp4 = path.join(tmp, 'tiny.mp4');

beforeAll(() => {
  // 0.6s 彩条真视频
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.6', '-pix_fmt', 'yuv420p', goodMp4], { stdio: 'pipe' });
  // 垃圾字节冒充 mp4(引擎把 HTML 错误页存成 mp4 的场景)
  fs.writeFileSync(junkMp4, Buffer.alloc(4096, 0x41));
  // 过小文件
  fs.writeFileSync(tinyMp4, Buffer.from('x'));
}, 30_000);

describe('v12.71 · probeVideoIntegrity', () => {
  it('真视频 → ok + 时长', async () => {
    const r = await probeVideoIntegrity(goodMp4);
    expect(r.ok).toBe(true);
    expect(r.durationSec).toBeGreaterThan(0.3);
  });

  it('垃圾字节 → probe-failed/no-video-stream', async () => {
    const r = await probeVideoIntegrity(junkMp4);
    expect(r.ok).toBe(false);
  });

  it('过小/缺失文件 → too-small / missing', async () => {
    expect((await probeVideoIntegrity(tinyMp4)).reason).toContain('too-small');
    expect((await probeVideoIntegrity(path.join(tmp, 'nope.mp4'))).reason).toBe('missing');
  });
});
