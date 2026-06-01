/**
 * /template/[token] · v2.19 P0.3 — 服务端封装 + OG metadata.
 *
 * 这是 server component, 只负责:
 *   1. 解析 token, 服务端读出 template (用 lib/template-share 直接读 DB, 不打 HTTP)
 *   2. 生成 og:title / og:description / og:image / twitter:card meta
 *   3. 把 token 透给 client component 渲染交互 UI
 *
 * OG 图本身由同目录的 opengraph-image.tsx 动态生成 (ImageResponse).
 *
 * 注意: 服务端读取不调用 incrementViewCount — view 计数只在 client fetch
 * /api/templates/shared/[token] 时 +1, 避免 og preview crawler 灌水.
 */

import type { Metadata } from 'next';
import SharedTemplateClient from './template-client';
import { getTemplateAssetForToken } from '@/lib/template-share';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const found = await getTemplateAssetForToken(token);

  if (!found) {
    return {
      title: '分享链接不可用 · Wind Comic',
      description: '这个模板分享链接不存在或已过期',
      robots: { index: false, follow: false },
    };
  }

  const meta = (found.asset.metadata || {}) as {
    icon?: string;
    nameEn?: string;
    tags?: string[];
    description?: string;
  };
  const icon = meta.icon || '📄';
  const name = found.asset.name || '未命名模板';
  const description = (found.asset.description || meta.description || '').slice(0, 160);
  const tagsSummary = meta.tags && meta.tags.length > 0
    ? `标签: ${meta.tags.slice(0, 4).join(' · ')}`
    : '';

  const ogTitle = `${icon} ${name} · Wind Comic 模板`;
  const ogDescription = description
    || `分享了一个 Wind Comic 故事模板 — 一键克隆到你的模板库. ${tagsSummary}`.trim();

  return {
    title: ogTitle,
    description: ogDescription,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      type: 'article',
      // opengraph-image.tsx 会自动注入 og:image — 不用手动指定 url
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
    },
    robots: { index: true, follow: true },
  };
}

export default async function SharedTemplatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedTemplateClient token={token} />;
}
