/**
 * v12.3.0 — 一键成片打包(阶段二十二):buildPublishPackage 纯函数。
 */
import { describe, it, expect } from 'vitest';
import { buildPublishPackage } from '@/lib/publish-package';
import { getPlatformSpec, type PlatformPack } from '@/lib/distribution';

const douyin = getPlatformSpec('douyin')!;
const mkPack = (over: Partial<PlatformPack> = {}): PlatformPack => ({
  platform: 'douyin', label: '抖音',
  titles: ['钩子标题', '备选一', '备选二'], tags: ['短剧', '反转', '爽文'],
  hook: '前3秒钩子', description: '一句话简介', tips: '黄金时段发',
  ...over,
});

describe('v12.3.0 · buildPublishPackage', () => {
  it('齐件 → ready=true,组装标题/话题/简介/复制文案', () => {
    const pkg = buildPublishPackage(douyin, mkPack(), { finalVideoUrl: 'http://x/v.mp4', platformVideoUrl: 'http://x/v-9x16.mp4', coverUrl: 'http://x/c.jpg' });
    expect(pkg.ready).toBe(true);
    expect(pkg.platform).toBe('douyin');
    expect(pkg.title).toBe('钩子标题');
    expect(pkg.titleAlternatives).toEqual(['备选一', '备选二']);
    expect(pkg.hashtags).toBe('#短剧 #反转 #爽文');
    expect(pkg.video.platformReady).toBe(true);           // 有平台成片
    expect(pkg.video.url).toBe('http://x/v-9x16.mp4');     // 平台成片优先
    expect(pkg.copyText).toContain('钩子标题');
    expect(pkg.copyText).toContain('#短剧');
    expect(pkg.warnings).toEqual([]);
  });

  it('无平台成片 → 回退原成片 + warning,platformReady=false', () => {
    const pkg = buildPublishPackage(douyin, mkPack(), { finalVideoUrl: 'http://x/v.mp4', coverUrl: 'http://x/c.jpg' });
    expect(pkg.video.url).toBe('http://x/v.mp4');
    expect(pkg.video.platformReady).toBe(false);
    expect(pkg.warnings.some((w) => w.includes('9:16'))).toBe(true);
    expect(pkg.ready).toBe(true); // 标题+(回退)视频+封面 齐
  });

  it('缺件 → ready=false + 对应 warnings(不报错)', () => {
    const pkg = buildPublishPackage(douyin, null, {});
    expect(pkg.ready).toBe(false);
    expect(pkg.title).toBe('');
    expect(pkg.warnings.some((w) => w.includes('标题'))).toBe(true);
    expect(pkg.warnings.some((w) => w.includes('成片'))).toBe(true);
    expect(pkg.warnings.some((w) => w.includes('封面'))).toBe(true);
  });

  it('tags 截到平台上限、标题超限告警', () => {
    const longTitle = 'A'.repeat(douyin.titleMaxLen + 10);
    const pkg = buildPublishPackage(douyin, mkPack({ titles: [longTitle], tags: Array.from({ length: 20 }, (_, i) => 't' + i) }), { finalVideoUrl: 'v', coverUrl: 'c' });
    expect(pkg.tags.length).toBe(douyin.tagCount);          // 截到 tagCount
    expect(pkg.warnings.some((w) => w.includes('标题超'))).toBe(true);
  });

  it('B站 aspect=16:9 透传到 spec/recommendedAspect', () => {
    const bili = getPlatformSpec('bilibili')!;
    const pkg = buildPublishPackage(bili, mkPack({ platform: 'bilibili', label: 'B站' }), { finalVideoUrl: 'v', coverUrl: 'c' });
    expect(pkg.spec.aspect).toBe('16:9');
    expect(pkg.video.recommendedAspect).toBe('16:9');
  });
});
