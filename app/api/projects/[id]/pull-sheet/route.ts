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
import { pickScriptAsset } from '@/lib/script-asset';
import { db } from '@/lib/db';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildPullSheetFromScript, toPullSheetCsv } from '@/lib/pull-sheet';
import { getUserFromRequest } from '../../../auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { requireProjectAccess } from '@/lib/auth-guard';

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
  // v12.230(鉴权复扫收口):本 GET 此前无鉴权 —— 知道 projectId 即可读取他人项目数据。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });


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
  // v12.381:走唯一入口选稿。原来直接取 [0] —— 而一个项目可以有主稿 + 若干 script-<lang> 翻译稿,
  // listAssetsByType 的 ORDER BY shot_number 在 shot_number 全为 NULL 时等于插入次序,
  // 先出过俄语版的项目就会拿俄语稿去导一份中文项目的场记表。
  const scriptRows = await listAssetsByType(id, 'script');
  let script: any = parseJson(pickScriptAsset(scriptRows).row?.data);
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

  // ── v12.152:剧本册导出(md / pdf,零生图 API)──
  const format = request.nextUrl.searchParams.get('format');
  if (format === 'md' || format === 'pdf') {
    const { pullSheetToMarkdown, buildScriptBookHtml } = await import('@/lib/script-export');
    // v12.160:PDF 附页取数(角色表 + 体检;md 轻量不带)
    const origin0 = request.nextUrl.origin;
    const charRows = format === 'pdf' ? await listAssetsByType(id, 'character') : [];
    const characters = charRows.map((r) => {
      const d = parseJson(r.data) || {};
      let u = r.persistent_url || (parseJson(r.media_urls) || [])[0] || '';
      if (u.startsWith('/')) u = `${origin0}${u}`;
      return { name: r.name, role: d.role || d.dna?.signature?.role || '', imageUrl: u };
    }).filter((c) => c.name);
    let health: Array<{ label: string; status: string; detail: string }> = [];
    if (format === 'pdf') {
      try {
        const { buildProjectHealth } = await import('@/lib/film-health-io');
        health = (await buildProjectHealth(id)).items;
      } catch { /* 体检失败不阻塞出册 */ }
    }
    const meta = {
      title: script?.title,
      logline: typeof script?.logline === 'string' ? script.logline : undefined,
      synopsis: typeof script?.synopsis === 'string' ? script.synopsis : undefined,
      style: typeof script?.style === 'string' ? script.style : undefined,
      characters: characters.length ? characters : undefined,
      health: health.length ? health : undefined,
    };
    if (format === 'md') {
      return new NextResponse(pullSheetToMarkdown(sheet, meta), {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="script-book-${encodeURIComponent(id)}.md"`,
        },
      });
    }
    // pdf:站内相对缩略图补全 origin(puppeteer setContent 下相对 URL 取不到)
    const origin = request.nextUrl.origin;
    const absSheet = {
      ...sheet,
      shots: sheet.shots.map((sh) => ({
        ...sh,
        thumbnail: sh.thumbnail && sh.thumbnail.startsWith('/') ? `${origin}${sh.thumbnail}` : sh.thumbnail,
      })),
    };
    const html = buildScriptBookHtml(absSheet, meta);
    try {
      const puppeteer = (await import('puppeteer')).default;
      // 优先系统 Chrome(本机开发环境惯例),没有再用 puppeteer 自带
      const browser = await puppeteer.launch({ headless: true, channel: 'chrome' }).catch(() => puppeteer.launch({ headless: true }));
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: 15_000 }).catch(() => {/* 图片慢加载不阻塞出册 */});
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '12mm', left: '8mm', right: '8mm' } });
        return new NextResponse(Buffer.from(pdf), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="script-book-${encodeURIComponent(id)}.pdf"`,
          },
        });
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (e) {
      console.error('[pull-sheet] pdf render failed:', e);
      return NextResponse.json({ message: `PDF 渲染失败:${e instanceof Error ? e.message.slice(0, 120) : ''}(可先用 md/csv 导出)` }, { status: 500 });
    }
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
