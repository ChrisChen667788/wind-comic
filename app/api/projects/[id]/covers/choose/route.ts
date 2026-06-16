/**
 * /api/projects/[id]/covers/choose (v12.3.2) — 封面定版 + 标题烧入(阶段二十二)。
 *
 * POST { candidateIndex?, imageUrl?, title? } → 选一张封面候选(或直接给 imageUrl),
 *   server 端把标题烧进安全区(无字体/无标题 → 保留原图,burned:false),
 *   落库为 `chosen-cover` 资产(publish-package 自动优先用它)。
 * Auth: 登录 + 属主/可编辑(与发布动作一致,改项目素材)。
 */
import { NextResponse } from 'next/server';
import path from 'path';
import { getUserFromRequest } from '../../../../auth/lib';
import { db } from '@/lib/db';
import { canEditProject } from '@/lib/project-share';
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { burnCoverTitle } from '@/services/cover-title-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  if (proj.user_id !== payload.sub && !(await canEditProject(id, payload.sub))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any = {}; try { body = await request.json(); } catch {}
  const title: string = typeof body?.title === 'string' ? body.title : '';

  // 解析候选图 URL:直接给 imageUrl 优先,否则按 index 从 cover-candidates 取
  let imageUrl: string | null = typeof body?.imageUrl === 'string' ? body.imageUrl : null;
  if (!imageUrl) {
    const rows = await listAssetsByType(id, 'cover-candidates');
    let cands: any[] = [];
    try { cands = JSON.parse(rows[0]?.data || '{}')?.candidates || []; } catch { /* ignore */ }
    const idx = Number.isInteger(body?.candidateIndex) ? body.candidateIndex : 0;
    imageUrl = cands[idx]?.imageUrl || cands[idx]?.url || null;
  }
  if (!imageUrl) return NextResponse.json({ error: '没有可选的封面候选(先生成封面)' }, { status: 400 });

  let result;
  try {
    result = await burnCoverTitle(imageUrl, title, { outputDir: path.join(process.cwd(), 'data', 'covers') });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'cover burn failed' }, { status: 500 });
  }

  const url = `/api/serve-file?path=${encodeURIComponent(result.outputPath)}`;
  await deleteAssetsByType(id, 'chosen-cover');
  await createAsset({
    projectId: id, type: 'chosen-cover', name: '定版封面',
    data: { burned: result.burned, title, srcImageUrl: imageUrl, reason: result.reason },
    mediaUrls: [url], persistentUrl: url, version: 1,
  });

  return NextResponse.json({ ok: true, url, burned: result.burned, reason: result.reason });
}
