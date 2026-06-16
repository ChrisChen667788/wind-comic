/**
 * v9.1 — lib/distribution 纯逻辑单测.
 */
import { describe, it, expect } from 'vitest';
import {
  PLATFORM_SPECS, getPlatformSpec, isPlatformId,
  buildDistributionPrompt, parseDistributionPack, distributionPackToText,
  type PlatformId,
} from '@/lib/distribution';

describe('v9.1 · platform specs', () => {
  it('7 个平台(含 v12.3.4 tiktok), id 唯一, 规格合理', () => {
    expect(PLATFORM_SPECS).toHaveLength(7);
    expect(new Set(PLATFORM_SPECS.map((s) => s.id)).size).toBe(7);
    expect(PLATFORM_SPECS.every((s) => s.titleMaxLen > 0 && s.tagCount > 0)).toBe(true);
    expect(getPlatformSpec('tiktok')?.aspect).toBe('9:16');
  });
  it('getPlatformSpec / isPlatformId', () => {
    expect(getPlatformSpec('douyin')?.label).toBe('抖音');
    expect(getPlatformSpec('nope')).toBeNull();
    expect(isPlatformId('xiaohongshu')).toBe(true);
    expect(isPlatformId('myspace')).toBe(false);
  });
});

describe('v9.1 · buildDistributionPrompt', () => {
  it('含片名/梗概/平台规格/钩子 + 要求 JSON', () => {
    const p = buildDistributionPrompt({
      title: '重生归来', synopsis: '霸总当街拆穿婚礼骗局', genre: '都市爽剧',
      hooks: ['当街掌掴', '秘密身份'], emotionPeak: '婚礼对峙',
      platforms: ['douyin', 'xiaohongshu'],
    });
    expect(p).toContain('重生归来');
    expect(p).toContain('霸总当街拆穿婚礼骗局');
    expect(p).toContain('抖音');
    expect(p).toContain('小红书');
    expect(p).toContain('当街掌掴');
    expect(p).toContain('婚礼对峙');
    expect(p).toContain('JSON');
  });
  it('空平台 → 退化到 douyin', () => {
    const p = buildDistributionPrompt({ title: 'x', synopsis: 'y', platforms: [] });
    expect(p).toContain('抖音');
  });
});

describe('v9.1 · parseDistributionPack', () => {
  const platforms: PlatformId[] = ['douyin', 'xiaohongshu'];

  it('合法 JSON → 结构化 + clamp 标题字数 + 标签去# 去重 限量', () => {
    const longTitle = '超长标题'.repeat(20); // > 抖音 55
    const raw = JSON.stringify({
      platforms: {
        douyin: { titles: [longTitle, 'B', 'C', 'D'], tags: ['#爽剧', '爽剧', '重生', '#霸总', 't5', 't6'], hook: '钩子', description: 'desc', tips: '晚8点发' },
        xiaohongshu: { title: '单标题', tags: '甜宠,#追剧 复仇', hook: 'h', description: 'd', tips: 't' },
      },
    });
    const pack = parseDistributionPack(raw, platforms);
    expect(pack.degraded).toBe(false);
    const dy = pack.platforms.find((p) => p.platform === 'douyin')!;
    expect(dy.titles[0].length).toBeLessThanOrEqual(55);  // clamp
    expect(dy.titles.length).toBeLessThanOrEqual(3);       // 最多 3 候选
    expect(dy.tags).not.toContain('#爽剧');                 // 去 #
    expect(dy.tags).toContain('爽剧');
    expect(new Set(dy.tags).size).toBe(dy.tags.length);     // 去重
    expect(dy.tags.length).toBeLessThanOrEqual(5);          // 抖音 tagCount=5
    const xhs = pack.platforms.find((p) => p.platform === 'xiaohongshu')!;
    expect(xhs.titles).toEqual(['单标题']);                  // title→titles 兼容
    expect(xhs.tags).toEqual(['甜宠', '追剧', '复仇']);       // 字符串 tags 拆分
  });

  it('JSON 夹在文字里 → 提取首个 {...}', () => {
    const raw = '好的, 这是结果:\n{"platforms":{"douyin":{"titles":["标题A"],"tags":["a"],"hook":"h","description":"d","tips":"t"}}}\n以上。';
    const pack = parseDistributionPack(raw, ['douyin']);
    expect(pack.degraded).toBe(false);
    expect(pack.platforms[0].titles[0]).toBe('标题A');
  });

  it('非 JSON / 空 → 降级 (degraded=true) 但结构完整', () => {
    const pack = parseDistributionPack('完全不是 json 啊', platforms);
    expect(pack.degraded).toBe(true);
    expect(pack.platforms).toHaveLength(2);
    expect(pack.platforms[0].titles.length).toBeGreaterThan(0); // 兜底占位
  });

  it('平台扁平结构 (无 platforms 包裹) 也能解析', () => {
    const raw = JSON.stringify({ douyin: { titles: ['T'], tags: ['x'], hook: 'h', description: 'd', tips: 'p' } });
    const pack = parseDistributionPack(raw, ['douyin']);
    expect(pack.platforms[0].titles).toEqual(['T']);
  });
});

describe('v9.1 · distributionPackToText', () => {
  it('按平台分段, 标签带 #', () => {
    const raw = JSON.stringify({ platforms: { douyin: { titles: ['标A', '标B'], tags: ['爽剧'], hook: 'H', description: 'D', tips: 'P' } } });
    const pack = parseDistributionPack(raw, ['douyin']);
    const txt = distributionPackToText(pack);
    expect(txt).toContain('【抖音】');
    expect(txt).toContain('标题: 标A');
    expect(txt).toContain('备选: 标B');
    expect(txt).toContain('#爽剧');
  });
});
