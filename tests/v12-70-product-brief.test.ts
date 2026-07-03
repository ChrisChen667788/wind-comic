/**
 * v12.70 — URL 一键品牌 brief:HTML 元数据抽取 + idea 组装。
 */
import { describe, it, expect } from 'vitest';
import { extractProductBrief, buildIdeaFromBrief } from '@/lib/product-brief';

const HTML = `<!doctype html><html><head>
<title>后备标题 - 商城</title>
<meta property="og:title" content="冷萃咖啡液 提神不失眠 10条装" />
<meta property="og:description" content="0糖0脂,冰水即溶,深度烘焙&amp;冷萃工艺" />
<meta property="og:image" content="https://cdn.example.com/p/coldbrew.jpg" />
<meta property="og:site_name" content="示例商城" />
</head><body></body></html>`;

describe('v12.70 · product-brief', () => {
  it('抽取 og 元数据(title/desc/image/siteName)+ HTML 实体解码', () => {
    const b = extractProductBrief(HTML);
    expect(b.title).toBe('冷萃咖啡液 提神不失眠 10条装');
    expect(b.description).toBe('0糖0脂,冰水即溶,深度烘焙&冷萃工艺');
    expect(b.imageUrl).toBe('https://cdn.example.com/p/coldbrew.jpg');
    expect(b.siteName).toBe('示例商城');
  });

  it('og 缺失时回退 <title>;属性乱序(content 在前)也能抽', () => {
    const b1 = extractProductBrief('<title>只有标题</title>');
    expect(b1.title).toBe('只有标题');
    const b2 = extractProductBrief(`<meta content="乱序标题" property="og:title">`);
    expect(b2.title).toBe('乱序标题');
  });

  it('空/垃圾 HTML 容错(全空字段)', () => {
    const b = extractProductBrief('');
    expect(b.title).toBe('');
    expect(b.imageUrl).toBe('');
  });

  it('buildIdeaFromBrief:带「电商广告片」触发词 + 卖点 + 竖屏/CTA 默认', () => {
    const idea = buildIdeaFromBrief(extractProductBrief(HTML));
    expect(idea).toContain('电商广告片');
    expect(idea).toContain('冷萃咖啡液');
    expect(idea).toContain('卖点:0糖0脂');
    expect(idea).toContain('竖屏');
    expect(idea).toContain('CTA');
    expect(idea.length).toBeLessThanOrEqual(800);
  });
});
