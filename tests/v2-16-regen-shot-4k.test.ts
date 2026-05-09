/**
 * Tests for v2.16 P1.3 — POST /api/projects/[id]/regenerate-shot-4k
 *
 * 锁路由层:
 *   - plan-gate: 非 pro+ → 402
 *   - 缺 shotNumber / 非整数 → 400
 *   - storyboard 不存在 → 404
 *   - 缺 KELING_API_KEY → 422
 *   - happy path: SSE 流出 status / progress / completed events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let HAS_KELING_KEY = true;
let USER_TIER: string = 'pro';
let MOCK_STORYBOARD: { media_urls: string; persistent_url: string | null; name: string } | null = {
  media_urls: JSON.stringify(['http://x/sb1.png']),
  persistent_url: null,
  name: 'shot 1 prompt',
};

vi.mock('@/lib/db', () => ({
  db: {
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes('subscription_tier')) {
          return { subscription_tier: USER_TIER };
        }
        if (sql.includes('project_assets') && sql.includes('storyboard')) {
          return MOCK_STORYBOARD;
        }
        return { id: 'test-user' };
      },
      run: () => ({ changes: 1 }),
    }),
  },
  now: () => new Date().toISOString(),
}));

vi.mock('../app/api/auth/lib', () => ({
  getUserFromRequest: () => ({ sub: 'test-user' }),
}));

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      keling: {
        apiKey: HAS_KELING_KEY ? 'fake-keling' : '',
        baseURL: 'http://fake',
      },
    };
  },
}));

vi.mock('@/services/kling.service', () => ({
  KlingService: class {
    async regenerateShotAt4K(_first: string, _prompt: string, opts?: any) {
      // 触发一次 progress 回调
      opts?.onProgress?.(50, '渲染 50%');
      return 'http://example.com/4k.mp4';
    }
  },
}));

const importPost = async () => {
  vi.resetModules();
  const mod = await import('@/app/api/projects/[id]/regenerate-shot-4k/route');
  return mod.POST;
};

const mkReq = (body: unknown) =>
  new Request('http://localhost/api/projects/p1/regenerate-shot-4k', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;

const mkParams = () => ({ params: Promise.resolve({ id: 'p1' }) });

beforeEach(() => {
  HAS_KELING_KEY = true;
  USER_TIER = 'pro';
  MOCK_STORYBOARD = {
    media_urls: JSON.stringify(['http://x/sb1.png']),
    persistent_url: null,
    name: 'shot 1 prompt',
  };
});

describe('/api/projects/[id]/regenerate-shot-4k — guards', () => {
  it('402 when user tier < pro', async () => {
    USER_TIER = 'creator';
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 1 }), mkParams());
    expect(res.status).toBe(402);
  });

  it('402 when user is free', async () => {
    USER_TIER = 'free';
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 1 }), mkParams());
    expect(res.status).toBe(402);
  });

  it('400 when shotNumber missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({}), mkParams());
    expect(res.status).toBe(400);
  });

  it('400 when shotNumber is not integer', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 'abc' }), mkParams());
    expect(res.status).toBe(400);
  });

  it('400 when shotNumber < 1', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 0 }), mkParams());
    expect(res.status).toBe(400);
  });

  it('404 when storyboard for shot is missing', async () => {
    MOCK_STORYBOARD = null;
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 99 }), mkParams());
    expect(res.status).toBe(404);
  });

  it('422 when KELING_API_KEY is missing', async () => {
    HAS_KELING_KEY = false;
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 1 }), mkParams());
    expect(res.status).toBe(422);
  });
});

describe('/api/projects/[id]/regenerate-shot-4k — happy path SSE', () => {
  it('returns SSE stream with status / progress / completed events', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 1, duration: 5 }), mkParams());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    // 读完整流
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }

    // 应该有 status / progress / completed 三种 event
    expect(buf).toContain('"type":"status"');
    expect(buf).toContain('"type":"progress"');
    expect(buf).toContain('"type":"completed"');
    expect(buf).toContain('"videoUrl":"http://example.com/4k.mp4"');
    expect(buf).toContain('"quality":"4k"');
  });

  it('enterprise tier also allowed (linear ranking)', async () => {
    USER_TIER = 'enterprise';
    const POST = await importPost();
    const res = await POST(mkReq({ shotNumber: 1 }), mkParams());
    expect(res.status).toBe(200);
  });
});
