/**
 * v12.104 — Vidu Q3 provider(经 qingyuntop):注册/capability/开关。
 */
import { describe, it, expect, afterEach } from 'vitest';

afterEach(() => { delete process.env.QYT_VIDU_DISABLE; });

describe('v12.104 · qyt-vidu provider', () => {
  it('注册成功:priority 75(kling 后 minimax 前),I2V+T2V', async () => {
    await import('@/lib/video-providers/builtins');
    const { listVideoProviders } = await import('@/lib/video-providers/registry');
    const p = listVideoProviders().find((x) => x.id === 'qyt-vidu')!;
    expect(p).toBeTruthy();
    expect(p.priority).toBe(75);
    expect(p.supportsImage2Video).toBe(true);
    expect(p.supportsText2Video).toBe(true);
  });

  it('QYT_VIDU_DISABLE=1 → available false(开关硬生效,与 key 无关)', async () => {
    const { hasQytVidu } = await import('@/services/qyt-vidu.service');
    process.env.QYT_VIDU_DISABLE = '1';
    expect(hasQytVidu()).toBe(false); // 有无 key 都必须 false
  });
});
