import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { preflightAll } from '@/lib/publish-preflight';
import { probeVideoIntegrity } from '@/services/video-composer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.73.0 — 发布预检:GET 项目成片 → ffprobe 硬指标 → 逐平台(抖音/小红书/视频号)核对。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const finals = await listAssetsByType(id, 'final_video');
  const fv = finals[0];
  const url = fv?.persistent_url || (fv?.media_urls ? (JSON.parse(fv.media_urls)[0] as string) : '');
  if (!url) return NextResponse.json({ message: '该项目还没有成片' }, { status: 404 });

  // 只支持本地 serve-file(成片一定是本地合成产物)
  const localPath = url.startsWith('/api/serve-file')
    ? decodeURIComponent(new URL(url, 'http://localhost').searchParams.get('path') || '')
    : '';
  if (!localPath) return NextResponse.json({ message: '成片不是本地产物,无法预检' }, { status: 422 });

  const probe = await probeVideoIntegrity(localPath);
  if (!probe.ok) return NextResponse.json({ message: `成片损坏: ${probe.reason}` }, { status: 422 });

  const meta = {
    width: probe.width || 0, height: probe.height || 0,
    durationSec: probe.durationSec || 0, hasAudio: !!probe.hasAudio, sizeBytes: probe.sizeBytes || 0,
  };
  return NextResponse.json({ ok: true, meta, platforms: preflightAll(meta) });
}
