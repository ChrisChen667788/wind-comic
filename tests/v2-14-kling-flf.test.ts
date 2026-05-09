/**
 * Tests for v2.14 P0.3 — KlingService.generateFirstLastFrame validation guards
 *
 * 我们不真打 Kling API (本地 jsdom 跑不了网络), 只验前置条件:
 *   - 缺 API key → throw
 *   - 缺首帧 / 尾帧 → throw
 *   - data: URI → throw (只接 http URL)
 *
 * 注: 用全局 flag (HAS_KEY) 控 mock 行为, 不用 vi.doMock + resetModules,
 * 避免单 fork 模式下跨文件 module 状态泄漏(v2-15 套件也用了 resetModules)。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let HAS_KEY = true;

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      keling: {
        apiKey: HAS_KEY ? 'test-key' : '',
        baseURL: 'https://api.klingai.com',
      },
    };
  },
}));

import { KlingService } from '@/services/kling.service';

beforeEach(() => {
  HAS_KEY = true;
});

describe('KlingService.generateFirstLastFrame', () => {
  it('throws when KELING_API_KEY is empty', async () => {
    HAS_KEY = false;
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('http://a/1.png', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/KELING_API_KEY is not configured/);
  });

  it('throws when first frame is missing', async () => {
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/首帧.*尾帧.*都必须有/);
  });

  it('throws when last frame is missing', async () => {
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('http://a/1.png', '', 'p'),
    ).rejects.toThrow(/首帧.*尾帧.*都必须有/);
  });

  it('throws when frame is data URI', async () => {
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('data:image/png;base64,abc', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/不接受 data URI/);
  });
});
