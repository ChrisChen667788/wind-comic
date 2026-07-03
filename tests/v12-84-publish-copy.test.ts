/**
 * v12.84 — 发布文案:prompt 组装 + 解析/截断/合规净化。
 */
import { describe, it, expect } from 'vitest';
import { buildPublishCopyPrompt, parsePublishCopy } from '@/lib/publish-copy';

describe('v12.84 · publish-copy', () => {
  it('prompt 带 JSON 结构约束 + 广告法提示 + 素材注入', () => {
    const p = buildPublishCopyPrompt({ idea: '冷萃咖啡', genre: '现代商业', synopsis: '清晨清醒', dialogues: ['来一口'] });
    expect(p.system).toContain('titles');
    expect(p.system).toContain('广告法');
    expect(p.user).toContain('冷萃咖啡');
    expect(p.user).toContain('来一口');
  });

  it('解析 markdown 包裹 JSON + 截断(标题≤30/封面≤12/话题≤8 去#)', () => {
    const raw = '```json\n' + JSON.stringify({
      titles: ['a'.repeat(50), '第二条', '第三条', '第四条'],
      hashtags: ['#咖啡', '提神', ...Array(10).fill('x')],
      coverTitle: '十二个字以上的封面大标题啊',
    }) + '\n```';
    const c = parsePublishCopy(raw)!;
    expect(c.titles.length).toBe(3);
    expect(c.titles[0].length).toBe(30);
    expect(c.hashtags.length).toBe(8);
    expect(c.hashtags[0]).toBe('咖啡');
    expect(c.coverTitle.length).toBeLessThanOrEqual(12);
  });

  it('违禁词被净化(标题「最强」→「出色」)', () => {
    const c = parsePublishCopy(JSON.stringify({ titles: ['最强冷萃来了'], hashtags: [], coverTitle: '根治疲惫' }))!;
    expect(c.titles[0]).toBe('出色冷萃来了');
    expect(c.coverTitle).toBe('改善疲惫');
  });

  it('无 titles → null', () => {
    expect(parsePublishCopy('{"hashtags":[]}')).toBeNull();
    expect(parsePublishCopy('垃圾输出')).toBeNull();
  });
});
