/**
 * Sprint C.1 — /api/u2v 验证路径单测
 *
 * 不打 Minimax 上游(那需要真 API key + 1-3 分钟出视频), 只锁住:
 *   · 缺 imageUrl → 400
 *   · 缺 prompt → 400
 *   · imageUrl 协议非法 → 400 (挡 file:// / javascript: 等)
 *   · prompt 超长 → 400
 *   · MINIMAX_API_KEY 缺 → 422 (不是 400, 因为入参是合法的, 是后端配置问题)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { prepare: () => ({ get: () => ({ id: 'test-user' }) }) },
  now: () => new Date().toISOString(),
}));
vi.mock('../app/api/auth/lib', () => ({
  getUserFromRequest: () => ({ sub: 'test-user' }),
}));
vi.mock('@/services/minimax.service', () => ({
  MinimaxService: class {
    async generateVideo() {
      return 'http://example.com/video.mp4';
    }
  },
}));
vi.mock('@/lib/asset-storage', () => ({
  persistAsset: async () => ({ url: '/api/serve-file?key=abc', size: 100 }),
}));

let API_CONFIG_HAS_KEY = true;
vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      minimax: {
        apiKey: API_CONFIG_HAS_KEY ? 'fake-key' : '',
        baseURL: 'http://fake',
      },
    };
  },
}));

const importPost = async () => {
  const mod = await import('@/app/api/u2v/route');
  return mod.POST;
};

const mkReq = (body: unknown) =>
  new Request('http://localhost/api/u2v', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'host': 'localhost:3000' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;

beforeEach(() => {
  API_CONFIG_HAS_KEY = true;
});

describe('/api/u2v validation (Sprint C.1)', () => {
  it('400 when imageUrl is missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ prompt: 'wave' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('imageUrl');
  });

  it('400 when prompt is missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ imageUrl: 'https://example.com/img.png' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('prompt');
  });

  it('400 when imageUrl protocol is not allowed', async () => {
    const POST = await importPost();
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.y/z.png']) {
      const res = await POST(mkReq({ imageUrl: bad, prompt: 'wave' }));
      expect(res.status).toBe(400);
    }
  });

  it('400 when prompt exceeds 500 chars', async () => {
    const POST = await importPost();
    const longPrompt = 'x'.repeat(501);
    const res = await POST(
      mkReq({ imageUrl: 'https://example.com/img.png', prompt: longPrompt }),
    );
    expect(res.status).toBe(400);
  });

  it('422 when MINIMAX_API_KEY is missing', async () => {
    API_CONFIG_HAS_KEY = false;
    vi.resetModules(); // re-import with new config
    const POST = await importPost();
    const res = await POST(
      mkReq({ imageUrl: 'https://example.com/img.png', prompt: 'wave' }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('MINIMAX_API_KEY');
  });

  it('200 returns videoUrl + duration when inputs valid', async () => {
    API_CONFIG_HAS_KEY = true;
    vi.resetModules();
    const POST = await importPost();
    const res = await POST(
      mkReq({ imageUrl: 'https://example.com/img.png', prompt: 'wave', duration: 6 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBe('http://example.com/video.mp4');
    expect(body.duration).toBe(6);
    expect(body.model).toBe('I2V-01');
  });

  it('clamps duration to 5 when invalid value supplied', async () => {
    API_CONFIG_HAS_KEY = true;
    vi.resetModules();
    const POST = await importPost();
    const res = await POST(
      mkReq({ imageUrl: 'https://example.com/img.png', prompt: 'wave', duration: 999 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duration).toBe(5); // default
  });
});
