/**
 * v12.86 — Hook 创意生成:prompt 约束 + 解析过滤。
 */
import { describe, it, expect } from 'vitest';
import { buildHookIdeasPrompt, parseHookIdeas } from '@/lib/publish-copy';

describe('v12.86 · hook-ideas', () => {
  it('prompt 带公式约束(痛点问句/≤14字/禁广告法)', () => {
    const p = buildHookIdeasPrompt({ idea: '冷萃', genre: '现代商业' });
    expect(p.system).toContain('痛点问句');
    expect(p.system).toContain('14');
    expect(p.system).toContain('广告法');
  });

  it('解析:净化+长度过滤+去重+≤5', () => {
    const hooks = parseHookIdeas(JSON.stringify({ hooks: [
      '熬夜脸,有救吗?', '熬夜脸,有救吗?', '最强提神来了', '这是一条超过十六个字上限的超长句子啊', 'a\nb', '早八人自救指南', '3秒清醒的秘密', '打工人续命水', '第七条不该出现',
    ] }))!;
    expect(hooks.length).toBe(5);
    expect(hooks[0]).toBe('熬夜脸,有救吗?');
    expect(hooks[1]).toBe('出色提神来了'); // 最强→出色
    expect(hooks).not.toContain('第七条不该出现');
  });

  it('全不合规 → null', () => {
    expect(parseHookIdeas('{"hooks":["这条也太长了完全超过十六个字的硬上限了吧"]}')).toBeNull();
    expect(parseHookIdeas('nope')).toBeNull();
  });
});
