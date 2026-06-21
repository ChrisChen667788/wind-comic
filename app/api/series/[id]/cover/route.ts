/**
 * POST /api/series/[id]/cover (阶段二十六 · v12.25.0) —— 生成季封面(系列主视觉海报)。
 * 用锚点集的画风(styleBible 作 sref)+ 系列名生成一张电影感 key art,存为锚点集的 `season_cover` 资产。
 * 安全:登录 + 只动本人系列。计费护栏:走主图生成,粗估 ¥0.3。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodes } from '@/lib/repos/series-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function urlOf(a: any): string | undefined {
  if (!a) return undefined;
  if (a.persistent_url) return a.persistent_url;
  try { const m = JSON.parse(a.media_urls || '[]'); return Array.isArray(m) ? m[0] : undefined; } catch { return undefined; }
}
const seriesName = (title: string) => (title || '').split(' 第')[0].trim() || '系列剧';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eps = await listSeriesEpisodes(id, payload.sub);
  if (eps.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });
  const anchor = eps[0];

  const { assertBudget } = await import('@/lib/budget-enforce');
  const b = await assertBudget({ userId: payload.sub, pendingCostCny: 0.3 });
  if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });

  // styleBible 作 sref 锁画风(没有则纯文生)
  const styleRef = urlOf((await listAssetsByType(anchor.id, 'styleBible'))[0]);
  const name = seriesName(anchor.title);
  const prompt = `Cinematic key art poster for a drama series titled "${name}". Bold dramatic composition, strong focal subject, space for title at top, moody cinematic lighting, high contrast, ultra-detailed, masterpiece. No text, no watermark.`;

  try {
    await import('@/lib/image-providers/builtins');
    const { dispatchImageGenerate } = await import('@/lib/image-providers/registry');
    const gen = await dispatchImageGenerate(
      { prompt, aspectRatio: (anchor.aspect || '9:16') as any, sref: styleRef },
      { refCount: styleRef ? 1 : 0 },
    );
    if (!gen.result?.imageUrl) {
      return NextResponse.json({ error: '封面生成失败: ' + gen.tried.map((t: any) => t.error).join(' | ').slice(0, 160) }, { status: 502 });
    }
    const persisted = await persistAsset(gen.result.imageUrl, { ext: 'png' }).catch(() => null);
    const coverUrl = persisted?.url || gen.result.imageUrl;
    await upsertAsset({ projectId: anchor.id, type: 'season_cover', name: '季封面', data: { seriesId: id, name }, mediaUrls: [coverUrl], persistentUrl: persisted?.url || null });
    return NextResponse.json({ ok: true, coverUrl });
  } catch (e) {
    return NextResponse.json({ error: '封面生成失败: ' + (e instanceof Error ? e.message : String(e)).slice(0, 160) }, { status: 502 });
  }
}
