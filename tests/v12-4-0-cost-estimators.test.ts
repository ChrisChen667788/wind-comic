/**
 * v12.4.0(阶段二十三)— 视频/图像成本估算器(主管线成本落库的纯函数地基)。
 */
import { describe, it, expect } from 'vitest';
import { estimateVideoCostCny, estimateImageCostCny, videoRateForProvider } from '@/lib/repos/cost-log-repo';

describe('v12.4.0 · 成本估算器', () => {
  it('videoRateForProvider:按引擎给保守 ¥/s,未知 0.3 兜底', () => {
    expect(videoRateForProvider('veo')).toBe(0.6);
    expect(videoRateForProvider('kling')).toBe(0.2);
    expect(videoRateForProvider('minimax')).toBe(0.1);
    expect(videoRateForProvider('vidu')).toBe(0.3);
    expect(videoRateForProvider('video-veo')).toBe(0.6); // 含子串也命中
    expect(videoRateForProvider('unknown')).toBe(0.3);
    expect(videoRateForProvider(undefined)).toBe(0.3);
  });

  it('estimateVideoCostCny:时长×费率,缺省保守兜底', () => {
    expect(estimateVideoCostCny(8, 0.6)).toBe(4.8);
    expect(estimateVideoCostCny(8, videoRateForProvider('minimax'))).toBe(0.8);
    expect(estimateVideoCostCny()).toBe(1.5);      // 缺时长 5s × 缺费率 0.3
    expect(estimateVideoCostCny(0, 0)).toBe(1.5);  // 0 视为缺,走兜底
  });

  it('estimateImageCostCny:引擎值优先,否则每张 ¥0.3', () => {
    expect(estimateImageCostCny()).toBe(0.3);
    expect(estimateImageCostCny(0.12)).toBe(0.12);
    expect(estimateImageCostCny(0)).toBe(0.3);
  });
});
