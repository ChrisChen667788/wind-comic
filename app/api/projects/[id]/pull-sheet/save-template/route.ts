/**
 * /api/projects/[id]/pull-sheet/save-template (v11.1.4) — 拉片结构沉淀为私有模板。
 *
 * POST {sheetSource?, title?, visibility?}
 *   把一张拉片表(出厂真值 / 外部拆条)的**结构**(镜数/时长/逐镜镜头语言)抽成
 *   FilmTemplate 存进既有模板市场 → 完成「拉完即用」闭环(爆款结构可复用)。
 *   默认 private(私有);也可 public 分享。需登录 + 源项目归属。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listAssetsByType, getAsset } from '@/lib/repos/asset-repo';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { getUserFromRequest } from '../../../../auth/lib';
import { buildPullSheetFromScript, type PullSheet } from '@/lib/pull-sheet';
import { extractTemplate, type TemplateElementSummary } from '@/lib/template-market';
import { saveTemplate } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function firstUrl(mediaUrls: string | null): string | null {
  const u = parseJson(mediaUrls);
  return Array.isArray(u) && typeof u[0] === 'string' ? u[0] : null;
}

async function loadFactorySheet(projectId: string): Promise<PullSheet> {
  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = parseJson(scriptRows[0]?.data);
  if (!Array.isArray(script?.shots)) {
    const r = db.prepare('SELECT title, script_data FROM projects WHERE id = ?').get(projectId) as
      | { title?: string; script_data?: string } | undefined;
    script = parseJson(r?.script_data) || {};
    if (!script.title && r?.title) script.title = r.title;
  }
  const [storyboards, videos] = await Promise.all([
    listAssetsByType(projectId, 'storyboard'),
    listAssetsByType(projectId, 'video'),
  ]);
  const toRefs = (rows: typeof storyboards) =>
    rows.filter((r) => typeof r.shot_number === 'number')
      .map((r) => ({ shotNumber: r.shot_number as number, url: r.persistent_url || firstUrl(r.media_urls) || '' }))
      .filter((m) => m.url);
  return buildPullSheetFromScript(script || {}, { storyboards: toRefs(storyboards), videos: toRefs(videos) });
}

/** 逐镜镜头语言频次 → 主导节奏标签(运镜越频繁/景别越紧 = 越快)。 */
function derivePacingTone(sheet: PullSheet): string | undefined {
  const moves = sheet.shots.filter((s) => s.cameraMovement && !/固定|locked|静止/.test(s.cameraMovement)).length;
  const ratio = sheet.shotCount > 0 ? moves / sheet.shotCount : 0;
  const avgDur = sheet.shotCount > 0 ? sheet.totalDurationSec / sheet.shotCount : 0;
  if (ratio >= 0.6 || avgDur <= 4) return '快节奏';
  if (ratio <= 0.2 && avgDur >= 8) return '慢节奏';
  return '中速';
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const sheetSource = typeof body?.sheetSource === 'string' ? body.sheetSource : 'factory';
  let sheet: PullSheet;
  if (sheetSource === 'factory') {
    sheet = await loadFactorySheet(id);
  } else {
    const asset = await getAsset(sheetSource);
    if (!asset || asset.project_id !== id || asset.type !== 'pull-sheet') {
      return NextResponse.json({ message: '拉片表不存在' }, { status: 404 });
    }
    sheet = parseJson(asset.data);
  }
  if (!sheet?.shots?.length) return NextResponse.json({ message: '拉片表为空,无法存模板' }, { status: 400 });

  const proj = db.prepare('SELECT style_id FROM projects WHERE id = ?').get(id) as { style_id?: string } | undefined;
  const distinctChars = new Set(sheet.shots.flatMap((s) => s.characters));
  const distinctScenes = new Set(sheet.shots.map((s) => s.scene).filter(Boolean));
  const elements: TemplateElementSummary[] = [];
  if (distinctChars.size) elements.push({ role: 'character', count: distinctChars.size });
  if (proj?.style_id) elements.push({ role: 'style', count: 1 });

  const pacingTone = derivePacingTone(sheet);
  const title = (typeof body?.title === 'string' && body.title.trim())
    ? body.title.trim().slice(0, 200) : `${sheet.title} · 结构模板`;

  const template = extractTemplate({
    id, title, style: proj?.style_id || '',
    elements, pacingTone, shotCount: sheet.shotCount,
    sourceProjectId: id,
  });

  const synopsisHint = `${sheet.shotCount} 镜 / ${sheet.totalDurationSec}s${pacingTone ? ` · ${pacingTone}` : ''};场景 ${distinctScenes.size}、角色 ${distinctChars.size}`;
  const saved = await saveTemplate({
    template,
    ownerId: payload.sub,
    payload: {
      style: proj?.style_id || undefined,
      pullSheetStructure: {
        shotCount: sheet.shotCount,
        totalDurationSec: sheet.totalDurationSec,
        synopsisHint,
        perShot: sheet.shots.map((s) => ({
          shotNumber: s.shotNumber, shotSize: s.shotSize, cameraMovement: s.cameraMovement, durationSec: s.durationSec,
        })),
      },
      ...(sheet.shots.find((s) => s.thumbnail)?.thumbnail ? { previewUrl: sheet.shots.find((s) => s.thumbnail)!.thumbnail! } : {}),
    },
    visibility: body?.visibility === 'public' ? 'public' : 'private',
  });

  return NextResponse.json({ ok: true, templateId: saved.id, title: saved.title, visibility: saved.visibility });
}
