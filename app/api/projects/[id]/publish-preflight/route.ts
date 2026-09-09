import { NextResponse } from 'next/server';
import { resolveVerifiedServeFilePath } from '@/lib/serve-file-sign';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { preflightAll } from '@/lib/publish-preflight';
import { probeVideoIntegrity } from '@/services/video-composer';
import { requireProjectAccess } from '@/lib/auth-guard';
import { auditAssetsForExport, exportAuditNote } from '@/lib/export-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.73.0 — 发布预检:GET 项目成片 → ffprobe 硬指标 → 逐平台(抖音/小红书/视频号)核对。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  // v12.312:同 export-platform —— 只查登录态,任意登录用户可读他人成片的 ffprobe 硬指标(IDOR)。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const finals = await listAssetsByType(id, 'final_video');
  const fv = finals[0];
  const url = fv?.persistent_url || (fv?.media_urls ? (JSON.parse(fv.media_urls)[0] as string) : '');
  if (!url) return NextResponse.json({ message: '该项目还没有成片' }, { status: 404 });

  // 只支持本地 serve-file(成片一定是本地合成产物)
  // v12.241:走验签+白名单
  const localPath = url.startsWith('/api/serve-file')
    ? (resolveVerifiedServeFilePath(url) || '')
    : '';
  if (!localPath) return NextResponse.json({ message: '成片不是本地产物,无法预检' }, { status: 422 });

  const probe = await probeVideoIntegrity(localPath);
  if (!probe.ok) return NextResponse.json({ message: `成片损坏: ${probe.reason}` }, { status: 422 });

  const meta = {
    width: probe.width || 0, height: probe.height || 0,
    durationSec: probe.durationSec || 0, hasAudio: !!probe.hasAudio, sizeBytes: probe.sizeBytes || 0,
  };

  // v12.429:预检此前只查**技术指标**(分辨率/时长/音轨),不查**内容里有没有假画面**。
  // 发布是把片子送到抖音/小红书/视频号 —— 一旦发出去就收不回来了,
  // 这里是最后一道能拦住「把引擎没出图的占位画面当成片发出去」的关口。
  // 仍然只告知不拦截(草稿号试发是正当用法),但必须让调用方拿得到这个事实。
  const auditRows = [
    ...(await listAssetsByType(id, 'storyboard')),
    ...(await listAssetsByType(id, 'video')),
    ...finals,
  ];
  const audit = auditAssetsForExport(auditRows as any);

  return NextResponse.json({
    ok: true,
    meta,
    platforms: preflightAll(meta),
    contentAudit: {
      placeholders: audit.placeholders,
      shots: audit.shots,
      note: exportAuditNote(audit),
    },
  });
}
