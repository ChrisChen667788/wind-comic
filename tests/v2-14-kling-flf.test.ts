/**
 * Tests for v2.14 P0.3 — KlingService.generateFirstLastFrame validation guards
 *
 * 我们不真打 Kling API (本地 jsdom 跑不了网络), 只验前置条件:
 *   - 缺 API key → throw
 *   - 缺首帧 / 尾帧 → throw
 *   - data: URI → throw (只接 http URL)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ⚠️ 在 import 之前 stub config, 否则 KlingService 构造时就把 apiKey 拿走了
vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    keling: { apiKey: '', baseURL: 'https://api.klingai.com' },
  },
}));

import { KlingService } from '@/services/kling.service';

describe('KlingService.generateFirstLastFrame — guard checks', () => {
  let svc: KlingService;
  beforeEach(() => { svc = new KlingService(); });

  it('throws when KELING_API_KEY is empty', async () => {
    await expect(
      svc.generateFirstLastFrame('http://a/1.png', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/KELING_API_KEY is not configured/);
  });
});

// 第二组用一个有效 key 的 mock, 检查参数 guard
describe('KlingService.generateFirstLastFrame — input guards (with mocked key)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/config', () => ({
      API_CONFIG: {
        keling: { apiKey: 'test-key', baseURL: 'https://api.klingai.com' },
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/lib/config');
    vi.resetModules();
  });

  it('throws when first frame is missing', async () => {
    const { KlingService: K } = await import('@/services/kling.service');
    const s = new K();
    await expect(s.generateFirstLastFrame('', 'http://a/2.png', 'p')).rejects.toThrow(/首帧.*尾帧.*都必须有/);
  });

  it('throws when last frame is missing', async () => {
    const { KlingService: K } = await import('@/services/kling.service');
    const s = new K();
    await expect(s.generateFirstLastFrame('http://a/1.png', '', 'p')).rejects.toThrow(/首帧.*尾帧.*都必须有/);
  });

  it('throws when frame is data URI', async () => {
    const { KlingService: K } = await import('@/services/kling.service');
    const s = new K();
    await expect(
      s.generateFirstLastFrame('data:image/png;base64,abc', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/不接受 data URI/);
  });
});
