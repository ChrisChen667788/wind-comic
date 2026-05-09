/**
 * v2.14 P1.3 — /api/u2v-flf 集成单测 (mock fetch + Kling/Minimax services)
 *
 * 不打真上游, 锁住:
 *   - 入参缺字段 → 400
 *   - 协议非法 → 400
 *   - 双引擎都缺 key → 422
 *   - happy path: Kling 返回 url → 200 model=Kling-FLF
 *   - Kling 失败 + Minimax ok → 200 model=Minimax-I2V-01-fallback + 带 warning
 *   - 全部失败 → 422
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──── 全局可调标志 ────
let HAS_KELING = true;
let HAS_MINIMAX = true;
let KLING_BEHAVIOR: 'ok' | 'throw' | 'empty' = 'ok';
let MINIMAX_BEHAVIOR: 'ok' | 'throw' | 'empty' = 'ok';

vi.mock('@/lib/db', () => ({
  db: { prepare: () => ({ get: () => ({ id: 'test-user' }) }) },
  now: () => new Date().toISOString(),
}));
vi.mock('../app/api/auth/lib', () => ({
  getUserFromRequest: () => ({ sub: 'test-user' }),
}));
vi.mock('@/lib/asset-storage', () => ({
  persistAsset: async () => ({ url: '/api/serve-file?key=abc', size: 100 }),
}));

vi.mock('@/services/kling.service', () => ({
  KlingService: class {
    async generateFirstLastFrame(_first: string, _last: string, _prompt: string) {
      if (KLING_BEHAVIOR === 'throw') throw new Error('kling boom');
      if (KLING_BEHAVIOR === 'empty') return '';
      return 'http://example.com/kling-flf.mp4';
    }
  },
}));

vi.mock('@/services/minimax.service', () => ({
  MinimaxService: class {
    async generateVideo(_url: string, _prompt: string) {
      if (MINIMAX_BEHAVIOR === 'throw') throw new Error('minimax boom');
      if (MINIMAX_BEHAVIOR === 'empty') return '';
      return 'http://example.com/minimax-fallback.mp4';
    }
  },
}));

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      keling: { apiKey: HAS_KELING ? 'fake-keling' : '', baseURL: 'http://fake' },
      minimax: { apiKey: HAS_MINIMAX ? 'fake-minimax' : '', baseURL: 'http://fake' },
    };
  },
}));

const importPost = async () => {
  vi.resetModules();
  const mod = await import('@/app/api/u2v-flf/route');
  return mod.POST;
};

const mkReq = (body: unknown) =>
  new Request('http://localhost/api/u2v-flf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;

beforeEach(() => {
  HAS_KELING = true;
  HAS_MINIMAX = true;
  KLING_BEHAVIOR = 'ok';
  MINIMAX_BEHAVIOR = 'ok';
});

describe('/api/u2v-flf input validation', () => {
  it('400 when firstFrameUrl missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ lastFrameUrl: 'http://x/2.png', prompt: 'p' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('firstFrameUrl');
  });

  it('400 when lastFrameUrl missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ firstFrameUrl: 'http://x/1.png', prompt: 'p' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('lastFrameUrl');
  });

  it('400 when prompt missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ firstFrameUrl: 'http://x/1.png', lastFrameUrl: 'http://x/2.png' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('prompt');
  });

  it('400 when frame URL has illegal protocol', async () => {
    const POST = await importPost();
    const res = await POST(
      mkReq({ firstFrameUrl: 'file:///etc/passwd', lastFrameUrl: 'http://x/2.png', prompt: 'p' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('协议非法');
  });

  it('400 when prompt > 500 chars', async () => {
    const POST = await importPost();
    const res = await POST(
      mkReq({
        firstFrameUrl: 'http://x/1.png',
        lastFrameUrl: 'http://x/2.png',
        prompt: 'x'.repeat(501),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('/api/u2v-flf engine routing', () => {
  it('422 when both KELING and MINIMAX keys are missing', async () => {
    HAS_KELING = false;
    HAS_MINIMAX = false;
    const POST = await importPost();
    const res = await POST(
      mkReq({ firstFrameUrl: 'http://x/1.png', lastFrameUrl: 'http://x/2.png', prompt: 'pan right' }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/KELING_API_KEY.*MINIMAX_API_KEY/);
  });

  it('200 + model=Kling-FLF when Kling succeeds', async () => {
    KLING_BEHAVIOR = 'ok';
    const POST = await importPost();
    const res = await POST(
      mkReq({
        firstFrameUrl: 'http://x/1.png',
        lastFrameUrl: 'http://x/2.png',
        prompt: 'pan right',
        duration: 5,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBe('http://example.com/kling-flf.mp4');
    expect(body.model).toBe('Kling-FLF');
    expect(body.duration).toBe(5);
    expect(body.warning).toBeUndefined();
  });

  it('200 + model=Minimax fallback + warning when Kling throws', async () => {
    KLING_BEHAVIOR = 'throw';
    MINIMAX_BEHAVIOR = 'ok';
    const POST = await importPost();
    // v2.16 P0.1 plan-gate: 10s 需 creator+, 测试 mock user 是 free,
    // 这里只验 Kling-throw → Minimax fallback 路径, 不验 plan-gate (它在另一个 test 里),
    // 所以用免费允许的 5s
    const res = await POST(
      mkReq({
        firstFrameUrl: 'http://x/1.png',
        lastFrameUrl: 'http://x/2.png',
        prompt: 'pan right',
        duration: 5,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBe('http://example.com/minimax-fallback.mp4');
    expect(body.model).toBe('Minimax-I2V-01-fallback');
    expect(body.warning).toContain('Kling FLF 不可用');
    expect(body.duration).toBe(5);
  });

  it('Minimax fallback used when Kling key missing entirely', async () => {
    HAS_KELING = false;
    MINIMAX_BEHAVIOR = 'ok';
    const POST = await importPost();
    const res = await POST(
      mkReq({
        firstFrameUrl: 'http://x/1.png',
        lastFrameUrl: 'http://x/2.png',
        prompt: 'pan right',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('Minimax-I2V-01-fallback');
  });

  it('422 when Kling fails AND Minimax also returns empty', async () => {
    KLING_BEHAVIOR = 'throw';
    MINIMAX_BEHAVIOR = 'empty';
    const POST = await importPost();
    const res = await POST(
      mkReq({ firstFrameUrl: 'http://x/1.png', lastFrameUrl: 'http://x/2.png', prompt: 'p' }),
    );
    expect(res.status).toBe(422);
  });

  it('v2.16 P0.1: plan-gate blocks free user from 10s FLF (Kling)', async () => {
    KLING_BEHAVIOR = 'ok';
    const POST = await importPost();
    const res = await POST(
      mkReq({
        firstFrameUrl: 'http://x/1.png',
        lastFrameUrl: 'http://x/2.png',
        prompt: 'pan right',
        duration: 10,
      }),
    );
    // mock user has no subscription_tier → defaults to 'free'; 10s requires creator+
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('plan_required');
    expect(body.required).toBe('creator');
  });

  it('cameraPreset is forwarded into prompt enhancement (smoke check)', async () => {
    KLING_BEHAVIOR = 'ok';
    const POST = await importPost();
    const res = await POST(
      mkReq({
        firstFrameUrl: 'http://x/1.png',
        lastFrameUrl: 'http://x/2.png',
        prompt: 'p',
        cameraPreset: 'orbit',
      }),
    );
    // 不爆炸即过 (我们在 service mock 里没断言 prompt, 但路由不应因 cameraPreset 出错)
    expect(res.status).toBe(200);
  });
});
