/**
 * v2.21 P1.3 → v2.24 G — LipSyncService (provider-routed).
 *
 * 测试用例聚焦"行为契约":
 *   - isAvailable / 没 provider 可用时
 *   - LIPSYNC_DISABLED=1 → 始终 false
 *   - data:/local URL → 拒绝 (任何 provider 都不收)
 *   - provider 失败 → 返原视频 + warning
 *
 * 注: v2.24 G 把 Kling/Sync.so/Hailuo 抽到 lipsync-providers.ts, 这里只测
 * LipSyncService 的 routing 行为. 各 provider 的具体协议测在 v2-24-lipsync-providers.test.ts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// 默认: 所有 provider key 都为空 (no provider available)
let MOCK_KELING_KEY = '';
let MOCK_MINIMAX_KEY = '';

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      keling: { apiKey: MOCK_KELING_KEY, baseURL: 'https://kling.example' },
      minimax: { apiKey: MOCK_MINIMAX_KEY, baseURL: 'https://minimax.example' },
      openai: { apiKey: '', baseURL: '', model: '' },
    };
  },
}));

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  MOCK_KELING_KEY = '';
  MOCK_MINIMAX_KEY = '';
  delete process.env.SYNCSO_API_KEY;
  delete process.env.LIPSYNC_DISABLED;
  delete process.env.LIPSYNC_PROVIDER;
});

afterEach(() => {
  delete process.env.LIPSYNC_DISABLED;
});

async function freshService() {
  vi.resetModules();
  const mod = await import('@/services/lipsync.service');
  return new mod.LipSyncService();
}

describe('v2.21+v2.24 · LipSyncService isAvailable (provider-routed)', () => {
  it('false when no provider configured', async () => {
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(false);
  });

  it('true when KELING key is set', async () => {
    MOCK_KELING_KEY = 'sk-real-keling-abc';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(true);
  });

  it('true when SYNCSO key is set', async () => {
    process.env.SYNCSO_API_KEY = 'sso-real';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(true);
  });

  it('true when MINIMAX (Hailuo) key is set', async () => {
    MOCK_MINIMAX_KEY = 'mm-real';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(true);
  });

  it('false when LIPSYNC_DISABLED=1 (overrides any provider)', async () => {
    MOCK_KELING_KEY = 'sk-real';
    process.env.LIPSYNC_DISABLED = '1';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(false);
  });

  it('placeholder keys are rejected', async () => {
    MOCK_KELING_KEY = 'your_x';
    MOCK_MINIMAX_KEY = 'your_y';
    process.env.SYNCSO_API_KEY = 'your_z';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(false);
  });
});

describe('v2.21+v2.24 · syncMouthToAudio fallback', () => {
  it('no provider → returns original + warning, no throw', async () => {
    const svc = await freshService();
    const r = await svc.syncMouthToAudio(
      'https://video.example/v.mp4',
      'https://audio.example/a.mp3',
    );
    expect(r.applied).toBe(false);
    expect(r.videoUrl).toBe('https://video.example/v.mp4');
    expect(r.warning).toMatch(/lip-sync|provider/);
  });

  it('LIPSYNC_DISABLED returns original', async () => {
    MOCK_KELING_KEY = 'sk-real';
    process.env.LIPSYNC_DISABLED = '1';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('disable');
  });

  it('data: video URL rejected before provider call', async () => {
    MOCK_KELING_KEY = 'sk-real';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('data:video/mp4;base64,xxx', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('http URL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('local file audio rejected', async () => {
    MOCK_KELING_KEY = 'sk-real';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', '/api/serve-file?path=/tmp/a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('http URL');
  });

  it('missing videoUrl rejected', async () => {
    MOCK_KELING_KEY = 'sk-real';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('缺失');
  });

  it('Kling 4xx → returns original + warning, no throw', async () => {
    MOCK_KELING_KEY = 'sk-real';
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 400,
      text: async () => '{"error":"bad"}',
    });
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toMatch(/400|Kling/);
  });

  it('Kling network throw caught, original returned', async () => {
    MOCK_KELING_KEY = 'sk-real';
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('ECONNRESET');
  });
});

describe('v2.24 G · listProviders', () => {
  it('lists available providers', async () => {
    MOCK_KELING_KEY = 'sk-real';
    process.env.SYNCSO_API_KEY = 'sso-real';
    const svc = await freshService();
    const providers = svc.listProviders();
    expect(providers).toContain('kling');
    expect(providers).toContain('syncso');
  });

  it('returns empty when nothing configured', async () => {
    const svc = await freshService();
    expect(svc.listProviders()).toEqual([]);
  });
});
