/**
 * /template/[token]/opengraph-image · v2.19 P0.3
 *
 * 动态 OG 图: 1200×630, 模板 icon + name + description + tags.
 * Twitter / 微信 / LinkedIn / Slack 抓取时显示这张图。
 *
 * 用 next/og 的 ImageResponse — Edge-style rendering (但因 lib/template-share 依赖
 * better-sqlite3, 必须留 nodejs runtime).
 */

import { ImageResponse } from 'next/og';
import { getTemplateAssetForToken } from '@/lib/template-share';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Wind Comic Shared Template';

export default async function OgImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await getTemplateAssetForToken(token);

  // 默认值 (token 不存在 / 已过期 仍要返回一张合理的图, 不要 500)
  let icon = '📄';
  let name = '模板分享';
  let description = '这个分享链接不存在或已过期';
  let tags: string[] = [];

  if (found) {
    const meta = (found.asset.metadata || {}) as {
      icon?: string;
      tags?: string[];
    };
    icon = meta.icon || '📄';
    name = found.asset.name || '未命名模板';
    description = (found.asset.description || '').slice(0, 120);
    tags = Array.isArray(meta.tags) ? meta.tags.slice(0, 4) : [];
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background:
            'linear-gradient(135deg, #0b0b14 0%, #1a1530 50%, #2d1b4e 100%)',
          padding: '70px 80px',
          fontFamily: 'sans-serif',
          color: '#f5e9d5',
        }}
      >
        {/* eyebrow */}
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            letterSpacing: '0.3em',
            color: '#d4af37',
            textTransform: 'uppercase',
            marginBottom: 28,
          }}
        >
          SHARED TEMPLATE · WIND COMIC
        </div>

        {/* main row: icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, marginBottom: 28 }}>
          <div style={{ fontSize: 140, lineHeight: 1 }}>{icon}</div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div
              style={{
                fontSize: 68,
                fontWeight: 700,
                lineHeight: 1.1,
                marginBottom: 12,
                color: '#fbf3e2',
              }}
            >
              {name}
            </div>
          </div>
        </div>

        {/* description */}
        {description ? (
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.4,
              color: '#cbb88a',
              marginBottom: 32,
              maxWidth: 1040,
              display: 'flex',
            }}
          >
            {description}
          </div>
        ) : null}

        {/* tags */}
        {tags.length > 0 ? (
          <div style={{ display: 'flex', gap: 14, marginTop: 'auto', flexWrap: 'wrap' }}>
            {tags.map((tag) => (
              <div
                key={tag}
                style={{
                  display: 'flex',
                  padding: '12px 26px',
                  fontSize: 22,
                  background: 'rgba(212, 175, 55, 0.18)',
                  color: '#d4af37',
                  borderRadius: 999,
                  border: '1px solid rgba(212, 175, 55, 0.42)',
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              marginTop: 'auto',
              fontSize: 24,
              color: '#8c7c5a',
              letterSpacing: '0.12em',
            }}
          >
            点击克隆这个模板到你的库 →
          </div>
        )}
      </div>
    ),
    size,
  );
}
