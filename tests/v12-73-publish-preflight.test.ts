/**
 * v12.73 — 发布预检:平台硬指标核对。
 */
import { describe, it, expect } from 'vitest';
import { evaluateForPlatform, preflightAll, PLATFORM_SPECS } from '@/lib/publish-preflight';

const GOOD = { width: 720, height: 1280, durationSec: 32, hasAudio: true, sizeBytes: 9_000_000 };

describe('v12.73 · publish preflight', () => {
  it('标准竖屏广告(720x1280/32s/有音轨/9MB)三平台全过', () => {
    const rs = preflightAll(GOOD);
    expect(rs.length).toBe(3);
    expect(rs.every((r) => r.pass)).toBe(true);
  });

  it('无音轨 → 阻断;横屏 → 抖音/小红书仅警告不阻断', () => {
    const noAudio = evaluateForPlatform({ ...GOOD, hasAudio: false }, PLATFORM_SPECS[0]);
    expect(noAudio.pass).toBe(false);
    expect(noAudio.issues.join()).toContain('无音轨');
    const landscape = evaluateForPlatform({ ...GOOD, width: 1280, height: 720 }, PLATFORM_SPECS[0]);
    expect(landscape.pass).toBe(true);
    expect(landscape.warnings.join()).toContain('9:16');
  });

  it('过短(<5s 抖音)与超大文件 → 阻断', () => {
    expect(evaluateForPlatform({ ...GOOD, durationSec: 3 }, PLATFORM_SPECS[0]).pass).toBe(false);
    expect(evaluateForPlatform({ ...GOOD, sizeBytes: 5 * 1024 ** 3 }, PLATFORM_SPECS[1]).pass).toBe(false);
  });

  it('低分辨率(短边 <540)→ 警告', () => {
    const r = evaluateForPlatform({ ...GOOD, width: 360, height: 640 }, PLATFORM_SPECS[0]);
    expect(r.pass).toBe(true);
    expect(r.warnings.join()).toContain('分辨率');
  });
});
