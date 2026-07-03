import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.88.0 — A/B 变体选胜:POST { variant: <shotNumber 序号> } → 把该 ab_variant 设为正式
 * final_video(幂等 upsert,原成片 URL 记入 data.replacedFrom 以便追溯)。闭环 v12.69 的变体机制。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({} as any));
  const variantNo = Number(body?.variant);
  if (!Number.isInteger(variantNo) || variantNo < 1) return NextResponse.json({ message: 'variant 需为变体序号(≥1)' }, { status: 400 });

  const parse = (s: string | null): any => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  const variants = await listAssetsByType(id, 'ab_variant');
  const v = variants.find((x) => x.shot_number === variantNo);
  if (!v) return NextResponse.json({ message: `无变体 #${variantNo}(现有: ${variants.map((x) => x.shot_number).join(',') || '无'})` }, { status: 404 });

  const url = v.persistent_url || parse(v.media_urls)?.[0];
  if (!url) return NextResponse.json({ message: '变体无可用 URL' }, { status: 422 });

  const finals = await listAssetsByType(id, 'final_video');
  const prevUrl = finals[0]?.persistent_url || parse(finals[0]?.media_urls)?.[0] || null;
  const vData = parse(v.data);

  await upsertAsset({
    projectId: id, type: 'final_video', name: '最终成片',
    data: { ...parse(finals[0]?.data), chosenVariant: variantNo, hookTitle: vData.hookTitle, replacedFrom: prevUrl },
    mediaUrls: [url], persistentUrl: url,
  });
  return NextResponse.json({ ok: true, finalVideoUrl: url, chosenVariant: variantNo, hookTitle: vData.hookTitle });
}
