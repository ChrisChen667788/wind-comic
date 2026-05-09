/**
 * Tests for v2.16 P0.2 — lib/video-transcode helper
 *
 * 不打真 ffmpeg (CI 环境可能没装), mock fluent-ffmpeg, 只验:
 *   - isValidResolution 白名单
 *   - 缓存命中 (skip ffmpeg 调用)
 *   - 不存在的源文件 → throw
 *   - 不支持的 resolution → throw
 *   - cached 标记正确
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isValidResolution } from '@/lib/video-transcode';

describe('isValidResolution', () => {
  it('accepts 720p / 1080p / 2160p', () => {
    expect(isValidResolution('720p')).toBe(true);
    expect(isValidResolution('1080p')).toBe(true);
    expect(isValidResolution('2160p')).toBe(true);
  });
  it('rejects unknown values', () => {
    expect(isValidResolution('480p')).toBe(false);
    expect(isValidResolution('4K')).toBe(false);
    expect(isValidResolution('')).toBe(false);
    expect(isValidResolution(null)).toBe(false);
    expect(isValidResolution(undefined)).toBe(false);
    expect(isValidResolution('1080P')).toBe(false); // 大小写敏感
  });
});

// 只对 cached 路径做完整集成测试 — 不命中缓存就跑真 ffmpeg, CI 装不一定有
describe('transcodeToResolution — cache hit (no real ffmpeg)', () => {
  let tmpDir: string;
  let sourcePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v216-cache-'));
    sourcePath = path.join(tmpDir, 'source.mp4');
    // 写一个 fake mp4 (10MB, 内容随便, 我们只 assert path)
    fs.writeFileSync(sourcePath, Buffer.alloc(10 * 1024 * 1024));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns cached result when output already exists with > 5MB', async () => {
    // 先在 outputDir 里放个"已经转好"的 6MB 文件
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const cachedPath = path.join(outputDir, 'source-1080p.mp4');
    fs.writeFileSync(cachedPath, Buffer.alloc(6 * 1024 * 1024));

    const { transcodeToResolution } = await import('@/lib/video-transcode');
    const r = await transcodeToResolution({
      sourcePath,
      resolution: '1080p',
      outputDir,
    });
    expect(r.cached).toBe(true);
    expect(r.outputPath).toBe(cachedPath);
    expect(r.elapsedMs).toBe(0);
    expect(r.fileSize).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('cache miss when previous output is < 5MB (corrupted partial transcode)', async () => {
    // 这个测试我们不让 ffmpeg 真跑 — vi.mock fluent-ffmpeg
    vi.resetModules();
    vi.doMock('fluent-ffmpeg', () => {
      const fakeChain: any = {
        outputOptions: () => fakeChain,
        output: (p: string) => {
          fs.writeFileSync(p, Buffer.alloc(8 * 1024 * 1024));
          return fakeChain;
        },
        on: (event: string, cb: any) => {
          if (event === 'end') setTimeout(() => cb(), 0);
          return fakeChain;
        },
        run: () => {},
      };
      const ffmpeg: any = (_: string) => fakeChain;
      ffmpeg.setFfmpegPath = () => {};
      return { default: ffmpeg };
    });

    const outputDir = path.join(tmpDir, 'out2');
    fs.mkdirSync(outputDir, { recursive: true });
    // 放个 1MB 的"半成品", 应被识别为 corrupted, 触发重转
    fs.writeFileSync(
      path.join(outputDir, 'source-1080p.mp4'),
      Buffer.alloc(1 * 1024 * 1024),
    );

    const { transcodeToResolution } = await import('@/lib/video-transcode');
    const r = await transcodeToResolution({
      sourcePath,
      resolution: '1080p',
      outputDir,
    });
    expect(r.cached).toBe(false);
    expect(r.fileSize).toBeGreaterThanOrEqual(8 * 1024 * 1024);

    vi.doUnmock('fluent-ffmpeg');
  });
});

describe('transcodeToResolution — input guards', () => {
  it('throws when source file missing', async () => {
    const { transcodeToResolution } = await import('@/lib/video-transcode');
    await expect(
      transcodeToResolution({
        sourcePath: '/tmp/this-does-not-exist-12345.mp4',
        resolution: '1080p',
      }),
    ).rejects.toThrow(/Source video not found/);
  });

  it('throws when resolution is bogus', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v216-bogus-'));
    const sourcePath = path.join(tmpDir, 's.mp4');
    fs.writeFileSync(sourcePath, Buffer.alloc(1024));
    try {
      const { transcodeToResolution } = await import('@/lib/video-transcode');
      await expect(
        transcodeToResolution({
          sourcePath,
          resolution: '4K-fake' as any,
        }),
      ).rejects.toThrow(/Unsupported resolution/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
