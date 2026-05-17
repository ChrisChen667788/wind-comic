/**
 * v2.21 P1.3 — LipSyncService.
 *
 * 测试用例聚焦"行为契约":
 *   - 没 key → isAvailable false, syncMouthToAudio 直接返原视频 + warning, 不报错
 *   - LIPSYNC_DISABLED=1 → 同上
 *   - data:/local URL → 拒绝
 *   - 有 key 但 API 4xx → 返原视频 + warning
 *
 * 实际 Kling API 集成留 staging 实测 (有真 key 后).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── config mock — 默认无 key ─────────────────────────────────────────────────
let MOCK_KEY = '';
let MOCK_BASE = 'https://api.example.com';

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      keling: { apiKey: MOCK_KEY, baseURL: MOCK_BASE },
      openai: { apiKey: '', baseURL: '', model: '' },
    };
  },
}));

// fetch mock — controlled per-test
const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  MOCK_KEY = '';
  delete process.env.LIPSYNC_DISABLED;
});

afterEach(() => {
  delete process.env.LIPSYNC_DISABLED;
});

async function freshService() {
  vi.resetModules();
  const mod = await import('@/services/lipsync.service');
  return new mod.LipSyncService();
}

describe('v2.21 P1.3 · LipSyncService isAvailable', () => {
  it('returns false when no key', async () => {
    MOCK_KEY = '';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(false);
  });

  it('returns false when key is placeholder "your_..."', async () => {
    MOCK_KEY = 'your_keling_key_here';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(false);
  });

  it('returns true when real key set', async () => {
    MOCK_KEY = 'sk-real-keling-abc123';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(true);
  });

  it('returns false when LIPSYNC_DISABLED=1', async () => {
    MOCK_KEY = 'sk-real-keling-abc';
    process.env.LIPSYNC_DISABLED = '1';
    const svc = await freshService();
    expect(svc.isAvailable()).toBe(false);
  });
});

describe('v2.21 P1.3 · syncMouthToAudio fallback', () => {
  it('no key → returns original video + warning', async () => {
    MOCK_KEY = '';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio(
      'https://video.example/v.mp4',
      'https://audio.example/a.mp3',
    );
    expect(r.applied).toBe(false);
    expect(r.videoUrl).toBe('https://video.example/v.mp4');
    expect(r.warning).toContain('KELING_API_KEY');
  });

  it('LIPSYNC_DISABLED → returns original + disabled note', async () => {
    MOCK_KEY = 'sk-real';
    process.env.LIPSYNC_DISABLED = '1';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('disable');
  });

  it('data: video URL → rejected before API call', async () => {
    MOCK_KEY = 'sk-real';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio(
      'data:video/mp4;base64,xxx',
      'https://a.mp3',
    );
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('http URL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('local file audio → rejected', async () => {
    MOCK_KEY = 'sk-real';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', '/api/serve-file?path=/tmp/a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('http URL');
  });

  it('missing videoUrl → rejected', async () => {
    MOCK_KEY = 'sk-real';
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toContain('缺失');
  });

  it('Kling 4xx → returns original + warning, never throws', async () => {
    MOCK_KEY = 'sk-real';
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid"}',
    });
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.videoUrl).toBe('https://v.mp4');
    expect(r.warning).toContain('400');
  });

  it('Kling success without task_id → fallback', async () => {
    MOCK_KEY = 'sk-real';
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }), // 没 task_id
    });
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.warning).toMatch(/task_id/);
  });

  it('Kling throws (network) → caught, original returned', async () => {
    MOCK_KEY = 'sk-real';
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    const svc = await freshService();
    const r = await svc.syncMouthToAudio('https://v.mp4', 'https://a.mp3');
    expect(r.applied).toBe(false);
    expect(r.videoUrl).toBe('https://v.mp4');
    expect(r.warning).toContain('ECONNRESET');
  });
});
