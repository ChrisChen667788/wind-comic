/**
 * /api/projects/[id]/publish-package (v12.3.0) — 一键成片打包(阶段二十二)。
 *
 * GET ?platform=<douyin|...> → 把已建好的散件组装成「可直发包」:
 *   分发文案(distribution PlatformPack)+ 成片(final_video)+ 封面(cover-candidates)
 *   + 平台规格(aspect/字数上限)→ buildPublishPackage。
 * 缺件不报错,写进 warnings;附 exportHint(让前端一键导该平台 aspect 成片)。
 * 读免鉴权(与项目其它只读端点一致;真发布动作 v12.3.1 才加 auth+gate)。
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPlatformSpec, isPlatformId, type PlatformPack } from '@/lib/distribution';
import { buildPublishPackage } from '@/lib/publish-package';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parse(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const platform = new URL(request.url).searchParams.get('platform') || '';
  if (!isPlatformId(platform)) {
    return NextResponse.json({ error: `platform 必须是 ${'douyin/kuaishou/shipinhao/xiaohongshu/youtube_shorts/bilibili'}` }, { status: 400 });
  }
  const spec = getPlatformSpec(platform)!;

  // 分发文案包 → 找该平台的 PlatformPack
  const distRow = db.prepare(`SELECT data FROM project_assets WHERE project_id = ? AND type = 'distribution' ORDER BY version DESC LIMIT 1`).get(id) as any;
  const distData = parse(distRow?.data);
  const pack: PlatformPack | null = Array.isArray(distData?.platforms)
    ? (distData.platforms.find((p: any) => p?.platform === platform) ?? null) : null;

  // 成片
  const finalRow = db.prepare(`SELECT media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = 'final_video' ORDER BY version DESC LIMIT 1`).get(id) as any;
  const finalUrls = parse(finalRow?.media_urls) || [];
  const finalVideoUrl = finalRow?.persistent_url || finalUrls[0] || null;

  // 封面:定版封面(v12.3.2)优先,否则封面候选首张
  const chosenRow = db.prepare(`SELECT persistent_url, media_urls FROM project_assets WHERE project_id = ? AND type = 'chosen-cover' ORDER BY version DESC LIMIT 1`).get(id) as any;
  let coverUrl: string | null = chosenRow?.persistent_url || (parse(chosenRow?.media_urls) || [])[0] || null;
  if (!coverUrl) {
    const covRow = db.prepare(`SELECT data FROM project_assets WHERE project_id = ? AND type = 'cover-candidates' ORDER BY version DESC LIMIT 1`).get(id) as any;
    const cands = parse(covRow?.data)?.candidates;
    if (Array.isArray(cands) && cands.length) coverUrl = cands[0]?.imageUrl || cands[0]?.url || null;
  }

  const bundle = buildPublishPackage(spec, pack, { finalVideoUrl, coverUrl });

  return NextResponse.json({
    ...bundle,
    hasDistributionPack: !!pack,
    // 让前端一键导出该平台 aspect 成片(带平台字幕样式)
    exportHint: { endpoint: `/api/projects/${id}/export-platform`, method: 'POST', body: { aspect: spec.aspect, subtitlePlatform: 'default' } },
  });
}
