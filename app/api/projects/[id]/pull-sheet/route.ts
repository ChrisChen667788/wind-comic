/**
 * /api/projects/[id]/pull-sheet (v11.1.0) — 自家项目拉片表(出厂参数真值)。
 *
 *   GET              → PullSheet JSON(script 真值 × 分镜图/视频资产,纯派生不落库)
 *   GET ?format=csv  → CSV 下载(BOM,Excel 直开)
 *
 *   GET ?external=1  → 外部参考片拉片清单(v11.1.1,assets type='pull-sheet')
 *   POST {videoUrl, name?} → 外部视频拆条 + 拉片(auth + 归属;PIPELINE_QUEUE=1 入队
 *        type='pull-sheet',否则同步执行)。零配置出骨架表,配 Vision key 逐镜打标。
 *
 * 读免鉴权(与项目 assets/asset-ledger GET 一致按 projectId 作用域)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildPullSheetFromScript, toPullSheetCsv } from '@/lib/pull-sheet';
import { getUserFromRequest } from '../../../auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';

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

  // v11.1.1: 外部参考片拉片清单
  if (request.nextUrl.searchParams.get('external') === '1') {
    const rows = await listAssetsByType(id, 'pull-sheet');
    const sheets = rows
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, sheet: parseJson(r.data) }))
      .filter((x) => x.sheet)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return NextResponse.json({ count: sheets.length, sheets });
  }

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl.trim() : '';
  if (!videoUrl || !(videoUrl.startsWith('http://') || videoUrl.startsWith('https://') || videoUrl.startsWith('/api/serve-file') || videoUrl.startsWith('data:'))) {
    return NextResponse.json({ message: '缺 videoUrl(http(s) / 站内 serve-file / data URI)' }, { status: 400 });
  }
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  const jobPayload = { projectId: id, videoUrl, name: name || undefined, userId: payload.sub };

  if (process.env.PIPELINE_QUEUE === '1') {
    const { enqueuePipelineJob } = await import('@/lib/repos/pipeline-job-repo');
    const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
    ensurePipelineWorker();
    const job = await enqueuePipelineJob({ type: 'pull-sheet', projectId: id, userId: payload.sub, payload: jobPayload });
    return NextResponse.json({ queued: true, jobId: job.id });
  }

  // 不开队列 → 同步执行(短片秒级;长片建议开队列)
  let result: unknown = null;
  let error = '';
  const { runPullSheetJob } = await import('@/lib/pull-sheet-job');
  await runPullSheetJob(jobPayload, (type, data) => {
    if (type === 'pullSheetDone') result = data;
    if (type === 'error') error = String((data as any)?.message || '拆条失败');
  });
  if (error) return NextResponse.json({ message: error }, { status: 422 });
  return NextResponse.json({ queued: false, done: result });
}
