/**
 * URL 一键品牌 brief(v12.70.0)。
 *
 * 竞品(Creatify/Topview)核心入口是「贴商品链接 → 出片」。本模块做前半程:
 * 从商品/品牌页 HTML 抽 og:title / og:description / og:image / <title> / meta description,
 * 组装成可直接投给 create-stream 的**商业广告 idea**(自动带「广告片」触发商业链路:
 * 现代锚 + photoreal 锚 + Hook/CTA + karaoke 字幕 + 合规净化)。
 * 纯函数(正则抽取,零 DOM 依赖)可单测;真正 fetch 在 API 路由。
 */

export interface ProductBrief {
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
}

const pick = (html: string, res: RegExp[]): string => {
  for (const re of res) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return '';
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

/** meta 容忍属性乱序(property 在前或 content 在前)。 */
const meta = (prop: string): RegExp[] => [
  new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'),
  new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'),
];

export function extractProductBrief(html: string): ProductBrief {
  const h = html || '';
  return {
    title: pick(h, [...meta('og:title'), ...meta('twitter:title'), /<title[^>]*>([^<]+)<\/title>/i]).slice(0, 120),
    description: pick(h, [...meta('og:description'), ...meta('description'), ...meta('twitter:description')]).slice(0, 300),
    imageUrl: pick(h, [...meta('og:image'), ...meta('twitter:image')]).slice(0, 500),
    siteName: pick(h, meta('og:site_name')).slice(0, 60),
  };
}

/** brief → 可直接开拍的商业广告 idea(带「广告片」触发词 + 竖屏/真人实拍默认)。 */
export function buildIdeaFromBrief(b: ProductBrief): string {
  const name = b.title || b.siteName || '这款产品';
  const desc = b.description ? `卖点:${b.description}` : '';
  return (
    `电商广告片:${name}。${desc}` +
    `真人实拍风格,现代都市生活场景,展现真实使用前后的变化与满足感,产品特写与真实肤感/质感细节。` +
    `竖屏适配抖音小红书,高级感真人实拍摄影,结尾 CTA 号召。30秒。`
  ).slice(0, 800);
}
