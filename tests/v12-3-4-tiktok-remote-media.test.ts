/**
 * v12.3.4 — TikTok 平台 + 云视频导出修复(阶段二十二收官)。纯逻辑 + 注入式下载,不真打网络。
 */
import { describe, it, expect, vi } from 'vitest';
import { PLATFORM_SPECS, getPlatformSpec, isPlatformId } from '@/lib/distribution';
import { listSubtitlePlatforms, getSubtitleStyle } from '@/lib/subtitle-burn';
import { getPublishAdapter } from '@/lib/publish-adapters';
import { isRemoteUrl, pickRemoteVideoUrl, downloadToTempFile } from '@/lib/remote-media';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('v12.3.4 · TikTok 平台接入', () => {
  it('PLATFORM_SPECS 含 tiktok(9:16 国际)', () => {
    const tk = getPlatformSpec('tiktok');
    expect(tk).toBeTruthy();
    expect(tk!.aspect).toBe('9:16');
    expect(isPlatformId('tiktok')).toBe(true);
    expect(PLATFORM_SPECS.some((s) => s.id === 'tiktok')).toBe(true);
  });

  it('字幕预设含 tiktok', () => {
    expect(listSubtitlePlatforms()).toContain('tiktok');
    const style = getSubtitleStyle('tiktok');
    expect(style.fontSize).toBeGreaterThan(0);
  });

  it('tiktok 走 manual 适配器(无公开 API 自配 → 诚实降级)', async () => {
    const a = getPublishAdapter('tiktok');
    expect(a.mode).toBe('manual');
    const r = await a.upload({ video: { url: 'x' } } as any);
    expect(r.status).toBe('manual');
    expect(r.instructions?.some((s) => s.toLowerCase().includes('tiktok'))).toBe(true);
  });
});

describe('v12.3.4 · 远端/云成片下载', () => {
  it('isRemoteUrl / pickRemoteVideoUrl 只认 http(s)', () => {
    expect(isRemoteUrl('https://cdn/v.mp4')).toBe(true);
    expect(isRemoteUrl('/api/serve-file?path=/x')).toBe(false);
    expect(isRemoteUrl('/abs/local.mp4')).toBe(false);
    expect(pickRemoteVideoUrl(['/local.mp4', '/api/serve-file?path=/x', 'http://cdn/v.mp4'])).toBe('http://cdn/v.mp4');
    expect(pickRemoteVideoUrl(['/local.mp4', null, undefined])).toBeNull();
  });

  it('downloadToTempFile 写出临时文件(注入 fetch,不真打网络)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => bytes.buffer,
    })) as any;
    const dir = path.join(os.tmpdir(), 'qfmj-remote-test');
    const file = await downloadToTempFile('https://cdn/v.mp4', { fetchImpl, dir });
    expect(file.endsWith('.mp4')).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file).length).toBe(5);
    fs.unlinkSync(file);
  });

  it('下载 HTTP 失败 → 抛错', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) })) as any;
    await expect(downloadToTempFile('https://cdn/missing.mp4', { fetchImpl })).rejects.toThrow(/404/);
  });

  it('非远端 URL → 拒绝', async () => {
    await expect(downloadToTempFile('/local/v.mp4')).rejects.toThrow(/非远端/);
  });

  it('超过 maxBytes → 拒绝', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new ArrayBuffer(100) })) as any;
    await expect(downloadToTempFile('https://cdn/big.mp4', { fetchImpl, maxBytes: 10 })).rejects.toThrow(/过大/);
  });
});
