/**
 * /api/projects/[id]/pull-sheet (v11.1.0) — 自家项目拉片表(出厂参数真值)。
 *
 *   GET              → PullSheet JSON(script 真值 × 分镜图/视频资产,纯派生不落库)
 *   GET ?format=csv  → CSV 下载(BOM,Excel 直开)
 *
 * 读免鉴权(与项目 assets/asset-ledger GET 一致按 projectId 作用域)。
 * 外部视频拆条(skeleton/vision 来源)见 v11.1.1,届时产物才落 type='pull-sheet'。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildPullSheetFromScript, toPullSheetCsv } from '@/lib/pull-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function firstUrl(mediaUrls: string | null): string | null {
  const u = parseJson(mediaUrls);
  return Array.isArray(u) && typeof u[0] === 'string' ? u[0] : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // script:资产优先,回退 projects.script_data(演示工程形)
  const scriptRows = await listAssetsByType(id, 'script');
  let script: any = parseJson(scriptRows[0]?.data);
  if (!Array.isArray(script?.shots)) {
    const r = db.prepare('SELECT title, script_data FROM projects WHERE id = ?').get(id) as
      | { title?: string; script_data?: string } | undefined;
    script = parseJson(r?.script_data) || {};
    if (!script.title && r?.title) script.title = r.title;
  }

  const [storyboards, videos] = await Promise.all([
    listAssetsByType(id, 'storyboard'),
    listAssetsByType(id, 'video'),
  ]);
  const toRefs = (rows: typeof storyboards) =>
    rows
      .filter((r) => typeof r.shot_number === 'number')
      .map((r) => ({ shotNumber: r.shot_number as number, url: r.persistent_url || firstUrl(r.media_urls) || '' }))
      .filter((m) => m.url);

  const sheet = buildPullSheetFromScript(script || {}, {
    storyboards: toRefs(storyboards),
    videos: toRefs(videos),
  });

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return new NextResponse(toPullSheetCsv(sheet), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pull-sheet-${encodeURIComponent(id)}.csv"`,
      },
    });
  }
  return NextResponse.json(sheet);
}
