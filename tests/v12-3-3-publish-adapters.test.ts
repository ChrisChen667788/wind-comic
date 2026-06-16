/**
 * v12.3.3 — BYO 发布上传适配器(阶段二十二)。纯逻辑,网络全 mock,绝不真打平台。
 */
import { describe, it, expect, vi } from 'vitest';
import { getPublishAdapter, listAdapterInfo, createYouTubeAdapter } from '@/lib/publish-adapters';
import type { PublishPackage } from '@/lib/publish-package';

function mkPkg(overrides: Partial<PublishPackage> = {}): PublishPackage {
  return {
    platform: 'youtube_shorts', label: 'YouTube Shorts',
    spec: { aspect: '9:16', titleMaxLen: 100, tagCount: 5, descMaxLen: 300 },
    title: 'Hook line', titleAlternatives: [], tags: ['ai', 'shorts'], hashtags: '#ai #shorts',
    description: 'desc', tips: '', video: { url: 'https://cdn/v.mp4', recommendedAspect: '9:16', platformReady: true },
    cover: { url: 'https://cdn/c.jpg' }, copyText: 'Hook line\n#ai #shorts\ndesc', ready: true, warnings: [],
    ...overrides,
  };
}

/** location-aware headers stub */
function headers(map: Record<string, string>) {
  return { get: (k: string) => map[k.toLowerCase()] ?? null };
}

describe('v12.3.3 · 国内平台 manual 诚实降级', () => {
  it('抖音 = manual,isConfigured 恒 false,upload 出手动指引(绝不 published)', async () => {
    const a = getPublishAdapter('douyin');
    expect(a.mode).toBe('manual');
    expect(a.isConfigured()).toBe(false);
    const r = await a.upload(mkPkg());
    expect(r.status).toBe('manual');
    expect(r.externalUrl).toBeNull();
    expect(r.instructions?.length).toBeGreaterThan(0);
    expect(await a.status('x')).toBeNull();
  });

  it('listAdapterInfo:youtube=api,其余=manual', () => {
    const info = listAdapterInfo({ getAccessToken: () => undefined });
    const yt = info.find((x) => x.platform === 'youtube_shorts')!;
    expect(yt.mode).toBe('api');
    expect(yt.configured).toBe(false);
    expect(info.filter((x) => x.platform !== 'youtube_shorts').every((x) => x.mode === 'manual')).toBe(true);
  });
});

describe('v12.3.3 · YouTube 参考适配器', () => {
  it('无 token → 诚实降级 manual(给配置指引,不假称 published)', async () => {
    const a = createYouTubeAdapter({ getAccessToken: () => undefined });
    expect(a.isConfigured()).toBe(false);
    const r = await a.upload(mkPkg(), { confirmed: true });
    expect(r.status).toBe('manual');
    expect(r.instructions?.some((s) => s.includes('YOUTUBE_ACCESS_TOKEN'))).toBe(true);
  });

  it('有 token 但未确认 → 降级 manual(防误触外发)', async () => {
    const a = createYouTubeAdapter({ getAccessToken: () => 'tok' });
    expect(a.isConfigured()).toBe(true);
    const r = await a.upload(mkPkg(), { confirmed: false });
    expect(r.status).toBe('manual');
  });

  it('有 token + 已确认 + mock 网络 → 真传成功 published + youtu.be 链接', async () => {
    const fetchImpl = vi.fn()
      // 1) resumable init → 返回 session URI
      .mockResolvedValueOnce({ ok: true, headers: headers({ location: 'https://upload/session-uri' }), text: async () => '' })
      // 2) PUT 字节 → 返回 {id}
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'vid_123' }), text: async () => '' });
    const a = createYouTubeAdapter({
      getAccessToken: () => 'tok',
      fetchImpl: fetchImpl as any,
      readVideo: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' }),
    });
    const r = await a.upload(mkPkg(), { confirmed: true });
    expect(r.status).toBe('published');
    expect(r.externalId).toBe('vid_123');
    expect(r.externalUrl).toBe('https://youtu.be/vid_123');
    // init 带了 Authorization Bearer
    expect((fetchImpl.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer tok');
  });

  it('init 失败 → status=failed(不假称成功)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, headers: headers({}), text: async () => 'forbidden' });
    const a = createYouTubeAdapter({
      getAccessToken: () => 'tok', fetchImpl: fetchImpl as any,
      readVideo: async () => ({ bytes: new Uint8Array([1]), contentType: 'video/mp4' }),
    });
    const r = await a.upload(mkPkg(), { confirmed: true });
    expect(r.status).toBe('failed');
    expect(r.message).toContain('403');
  });

  it('缺成片 URL → failed', async () => {
    const a = createYouTubeAdapter({ getAccessToken: () => 'tok' });
    const r = await a.upload(mkPkg({ video: { url: null, recommendedAspect: '9:16', platformReady: false } }), { confirmed: true });
    expect(r.status).toBe('failed');
  });
});
