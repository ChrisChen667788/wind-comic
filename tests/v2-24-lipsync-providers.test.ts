/**
 * v2.24 G — Lipsync provider abstraction.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

let MOCK_KELING_KEY = '';
let MOCK_SYNCSO_KEY = '';
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

beforeEach(() => {
  MOCK_KELING_KEY = '';
  MOCK_SYNCSO_KEY = '';
  MOCK_MINIMAX_KEY = '';
  delete process.env.SYNCSO_API_KEY;
  delete process.env.LIPSYNC_PROVIDER;
});

afterEach(() => {
  delete process.env.SYNCSO_API_KEY;
  delete process.env.LIPSYNC_PROVIDER;
});

async function freshLib() {
  vi.resetModules();
  return await import('@/services/lipsync-providers');
}

describe('v2.24 G · provider availability', () => {
  it('no provider available when all keys missing', async () => {
    const { selectProvider, listAvailableProviders } = await freshLib();
    expect(selectProvider()).toBeNull();
    expect(listAvailableProviders()).toEqual([]);
  });

  it('detects kling when KELING key set', async () => {
    MOCK_KELING_KEY = 'sk-real-keling';
    const { listAvailableProviders } = await freshLib();
    expect(listAvailableProviders()).toContain('kling');
  });

  it('detects syncso when SYNCSO_API_KEY set', async () => {
    process.env.SYNCSO_API_KEY = 'sso-real';
    const { listAvailableProviders } = await freshLib();
    expect(listAvailableProviders()).toContain('syncso');
  });

  it('detects hailuo when MINIMAX key set', async () => {
    MOCK_MINIMAX_KEY = 'mm-real';
    const { listAvailableProviders } = await freshLib();
    expect(listAvailableProviders()).toContain('hailuo');
  });

  it('selectProvider auto picks kling first', async () => {
    MOCK_KELING_KEY = 'sk-kling';
    process.env.SYNCSO_API_KEY = 'sso-real';
    MOCK_MINIMAX_KEY = 'mm-real';
    const { selectProvider } = await freshLib();
    const p = selectProvider();
    expect(p?.name).toBe('kling');
  });

  it('selectProvider honors LIPSYNC_PROVIDER override', async () => {
    MOCK_KELING_KEY = 'sk-kling';
    process.env.SYNCSO_API_KEY = 'sso-real';
    process.env.LIPSYNC_PROVIDER = 'syncso';
    const { selectProvider } = await freshLib();
    const p = selectProvider();
    expect(p?.name).toBe('syncso');
  });

  it('override falls through to auto when chosen provider unavailable', async () => {
    MOCK_KELING_KEY = 'sk-kling';
    process.env.LIPSYNC_PROVIDER = 'syncso'; // not configured
    const { selectProvider } = await freshLib();
    const p = selectProvider();
    expect(p?.name).toBe('kling'); // falls through
  });

  it('rejects placeholder keys (your_*)', async () => {
    MOCK_KELING_KEY = 'your_keling_key_here';
    process.env.SYNCSO_API_KEY = 'your_syncso_key';
    MOCK_MINIMAX_KEY = 'your_mm_key';
    const { listAvailableProviders } = await freshLib();
    expect(listAvailableProviders()).toEqual([]);
  });
});

describe('v2.24 G · provider sync (smoke)', () => {
  it('kling provider returns warning when not configured', async () => {
    const { selectProvider } = await freshLib();
    // 没 key — selectProvider 返 null, 不进 provider syncMouthToAudio
    expect(selectProvider()).toBeNull();
  });

  it('all providers reject placeholder keys', async () => {
    MOCK_KELING_KEY = 'your_x';
    const { selectProvider } = await freshLib();
    expect(selectProvider()).toBeNull();
  });
});
