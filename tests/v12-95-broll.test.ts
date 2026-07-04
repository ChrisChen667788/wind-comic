/**
 * v12.95 — Pexels B-roll 兜底:查询构造 + 选片 + 记账。
 */
import { describe, it, expect } from 'vitest';
import { buildBrollQuery, pickBestBrollFile } from '@/lib/broll';
import { summarizeQualityLedger } from '@/lib/quality-report';

describe('v12.95 · B-roll', () => {
  it('buildBrollQuery:剥镜头语言前缀/节拍/相机词,取实义词 ≤8', () => {
    const q = buildBrollQuery('static on 50mm lens, MS, eye level angle: close-up of amber cold brew coffee slowly dripping into a glass');
    expect(q).not.toMatch(/lens|static|angle|close/);
    expect(q).toContain('amber');
    expect(q).toContain('coffee');
    expect(q.split(' ').length).toBeLessThanOrEqual(8);
    expect(buildBrollQuery('')).toBe('');
  });

  it('pickBestBrollFile:画幅方向匹配 + 短边 540-1200 + 时长优先', () => {
    const vids = [
      { duration: 10, video_files: [
        { width: 1920, height: 1080, link: 'L-horiz-hd', quality: 'hd' },
        { width: 720, height: 1280, link: 'L-vert-720', quality: 'hd' },
        { width: 360, height: 640, link: 'L-vert-tiny', quality: 'sd' },
        { width: 2160, height: 3840, link: 'L-vert-4k', quality: 'hd' },
      ] },
      { duration: 2, video_files: [{ width: 1080, height: 1920, link: 'L-vert-short', quality: 'hd' }] },
    ];
    expect(pickBestBrollFile(vids as any, true, 4)).toBe('L-vert-720'); // 竖屏、时长够、分辨率合适
    expect(pickBestBrollFile(vids as any, false, 4)).toBe('L-horiz-hd');
    expect(pickBestBrollFile([], true, 4)).toBeNull();
  });

  it('broll-fallback 记账:扣 8/镜、计入 degradedShots、摘要有「实拍素材兜底」', () => {
    const r = summarizeQualityLedger([{ shot: 4, kind: 'broll-fallback', detail: 'coffee' }]);
    expect(r.healthScore).toBe(92);
    expect(r.degradedShots).toEqual([4]);
    expect(r.summary).toContain('1 镜实拍素材兜底');
  });
});
