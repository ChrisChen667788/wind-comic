/**
 * v9.1.3 — AI 竖屏封面候选端点.
 *
 * GET  → 已落库的封面候选 (project_assets type='cover-candidates') 或 {candidates:[], safeArea}
 * POST → 读剧本(片名/主角) + 项目画风 → buildCoverPrompts(3) → MiniMax image-01 (9:16, T2I)
 *        → 覆盖落库 → 返回 {candidates, safeArea, degraded}
 *
 * 出图费时/耗额度; 单张失败不拖累其他 (Promise.allSettled); 全失败 → 502。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { getProject } from '@/lib/repos/project-repo';
import { API_CONFIG } from '@/lib/config';
import {
  buildCoverPrompts, pickProtagonist, getTitleSafeArea, COVER_ASPECT,
  type CoverCandidate,
} from '@/lib/cover-candidates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safeArea = getTitleSafeArea();
  const rows = await listAssetsByType(id, 'cover-candidates');
  if (!rows.length) return NextResponse.json({ candidates: [], safeArea });
  try {
    const d = JSON.parse(rows[0].data || '{}');
    return NextResponse.json({ candidates: d.candidates || [], safeArea: d.safeArea || safeArea, title: d.title, generatedAt: d.generatedAt });
  } catch {
    return NextResponse.json({ candidates: [], safeArea });
  }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proj = await getProject(id);
  if (!proj) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  // 片名 / 主角 (剧本优先, project meta 兜底) + 画风
  let title = (proj.title || '').trim();
  let protagonist = '';
  const scripts = await listAssetsByType(id, 'script');
  if (scripts.length) {
    try {
      const d = JSON.parse(scripts[0].data || '{}');
      if (d.title) title = String(d.title).trim();
      protagonist = pickProtagonist(d.shots);
    } catch { /* 用 project meta 兜底 */ }
  }
  if (!title) {
    return NextResponse.json({ error: '该项目还没有片名/剧本, 先生成剧本再做封面' }, { status: 400 });
  }
  const style = String((proj as any).style_id || (proj as any).styleId || '').trim();

  if (!API_CONFIG.minimax.apiKey) {
    return NextResponse.json({ error: 'MINIMAX_API_KEY 未配置, 封面依赖 MiniMax image-01 出图' }, { status: 422 });
  }

  const comps = buildCoverPrompts({ title, protagonist, style, count: 3 });

  // 并行出 3 张 9:16; 单张失败不拖累其他
  const { MinimaxService } = await import('@/services/minimax.service');
  const svc = new MinimaxService();
  const settled = await Promise.allSettled(
    comps.map((c) => svc.generateImage(c.prompt, { aspectRatio: COVER_ASPECT })),
  );
  const candidates: CoverCandidate[] = comps.map((c, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value && !String(r.value).startsWith('data:')) {
      return { ...c, imageUrl: String(r.value) };
    }
    const reason = r.status === 'rejected'
      ? (r.reason instanceof Error ? r.reason.message : String(r.reason))
      : '出图返回空';
    return { ...c, error: reason.slice(0, 200) };
  });

  const safeArea = getTitleSafeArea();
  const ok = candidates.filter((c) => c.imageUrl);
  const degraded = ok.length < candidates.length;

  // 覆盖落库 (一项目一组封面候选)
  const data = { candidates, safeArea, title, protagonist, generatedAt: new Date().toISOString() };
  await deleteAssetsByType(id, 'cover-candidates');
  await createAsset({
    projectId: id, type: 'cover-candidates', name: '封面候选', data,
    mediaUrls: ok.map((c) => c.imageUrl!),
  });

  if (ok.length === 0) {
    return NextResponse.json({ candidates, safeArea, degraded: true, error: '全部封面出图失败, 请稍后重试' }, { status: 502 });
  }
  return NextResponse.json({ candidates, safeArea, degraded });
}
