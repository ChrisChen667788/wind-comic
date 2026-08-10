/**
 * /api/projects/[id]/lipsync-align · v9.7.14
 *
 * 存/读 实测的「口型-音频对齐分」(shotNumber → 0-100,来自面板 Web Audio 测量 / 批量 QC)。
 * 存 `project_assets type='lipsync-align'`(一项目一条,合并式)。publish-readiness 据此并入发布门禁。
 */
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { getDbDriver, type DbExecutor } from '@/lib/db-driver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readScores(id: string, exec?: DbExecutor): Promise<Record<string, number>> {
  const rows = await listAssetsByType(id, 'lipsync-align', exec);
  try { return JSON.parse(rows[0]?.data || '{}')?.scores || {}; } catch { return {}; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  return NextResponse.json({ scores: await readScores(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const body = (await request.json().catch(() => ({}))) as { scores?: Record<string, unknown> };
  const incoming = body?.scores && typeof body.scores === 'object' ? body.scores : {};
  // v12.306:**读-合并-删-插**整体必须在同一事务里。
  // 病根:两个标签页同时提交不同镜头的分数时 ——
  //   A 读到 {shot1:80},合并 shot2 → {shot1:80, shot2:90}
  //   B 读到 {shot1:80},合并 shot3 → {shot1:80, shot3:70}
  //   A 删+插,B 删+插 → **A 的 shot2 被彻底覆盖**,再也不会出现。
  // 而 publish-readiness 拿这份分做发布门禁 —— 漏掉的镜头会让门禁**错误地放行**。
  const merged = await getDbDriver().transaction(async (tx: DbExecutor) => {
    const cur: Record<string, number> = { ...(await readScores(id, tx)) };
    for (const [k, v] of Object.entries(incoming)) {
      const n = Number(v);
      if (String(k).trim() && Number.isFinite(n)) cur[String(k)] = Math.round(Math.max(0, Math.min(100, n)));
    }
    await deleteAssetsByType(id, 'lipsync-align', tx);
    await createAsset({ projectId: id, type: 'lipsync-align', name: '口型-音频对齐分', data: { scores: cur }, version: 1 }, tx);
    return cur;
  });
  return NextResponse.json({ ok: true, scores: merged });
}
