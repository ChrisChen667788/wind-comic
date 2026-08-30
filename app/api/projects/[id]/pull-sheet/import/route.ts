/**
 * POST /api/projects/[id]/pull-sheet/import (v12.154) — 分镜表 CSV 回灌。
 *
 * 导出 CSV → Excel 改 → 这里 merge 回剧本(白名单字段,按镜号,只写有变化的)。
 * 双写:script 资产 + projects.script_data(走 repo,双驱动一致 —— v12.153 教训:
 * 别用 db.prepare 直查/直写)。auth + 项目归属;返回变更摘要供前端展示。
 */
import { NextRequest, NextResponse } from 'next/server';
import { pickScriptAsset } from '@/lib/script-asset';
import { listAssetsByType, updateAssetBySelector } from '@/lib/repos/asset-repo';
import { getOwnedProject, updateProjectById } from '@/lib/repos/project-repo';
import { getUserFromRequest } from '../../../../auth/lib';
import { parsePullSheetRows, mergePullSheetIntoScript } from '@/lib/pull-sheet-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const project = await getOwnedProject(id, payload.sub);
  if (!project) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const csv = typeof body?.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return NextResponse.json({ message: '缺 csv 内容(Excel 请另存为 CSV 再上传)' }, { status: 400 });
  if (csv.length > 2_000_000) return NextResponse.json({ message: 'CSV 超过 2MB 上限' }, { status: 413 });

  const { rows, badLines } = parsePullSheetRows(csv);
  if (rows.length === 0) {
    return NextResponse.json({ message: '没解析出任何分镜行 —— 请用「导出 CSV」的原始表头(镜头列必须保留)' }, { status: 422 });
  }

  // script:资产优先,回退 projects.script_data(与 pull-sheet GET 同款取数)
  // v12.383:CSV 回灌是**读一条、算 merge、再写回同一条**,所以取稿和写回必须
  // 指向同一条资产 —— 而且得是选出来的那条,不是 [0]。
  // v12.381 立了 pickScriptAsset 这个唯一入口,却只接了三个消费方,本路由漏了:
  // 多语版项目里 script-ru 一旦排到 [0],owner 在 Excel 改好的分镜会被 merge 进俄语稿,
  // 中文主稿一个字没改,而 projects.script_data 同步成中俄混杂内容 —— 接口还是 200。
  const scriptRows = await listAssetsByType(id, 'script');
  const scriptPick = pickScriptAsset(scriptRows);
  let script: any = parseJson(scriptPick.row?.data);
  let source: 'asset' | 'project' = 'asset';
  if (!Array.isArray(script?.shots)) {
    script = parseJson((project as any).script_data) || {};
    source = 'project';
  }
  if (!Array.isArray(script?.shots) || script.shots.length === 0) {
    return NextResponse.json({ message: '项目还没有剧本,先完成创作再回灌' }, { status: 422 });
  }

  const { script: merged, changes, unknownShots } = mergePullSheetIntoScript(script, rows);

  if (changes.length > 0) {
    // 双写:有 script 资产则更新之;projects.script_data 始终同步(项目页读它)
    if (source === 'asset' && scriptPick.row) {
      // selector 无 shotNumber 时按 name 匹配 —— 必须带上资产名,否则 name=undefined 匹配 0 行静默丢写
      await updateAssetBySelector(id, { type: 'script', name: scriptPick.row.name }, { data: merged });
    }
    await updateProjectById(id, { script_data: JSON.stringify(merged) });
  }

  // v12.159:视觉字段(改了会影响画面)变更的镜 → 前端提供「一键重渲受影响镜」
  const VISUAL_LABELS = new Set(['画面内容', '景别', '构图', '机位角度', '运镜方法', '焦距与景深', '光影与色调']);
  const affectedShots = [...new Set(changes.filter((c) => VISUAL_LABELS.has(c.field)).map((c) => c.shotNumber))].sort((a, b) => a - b);

  return NextResponse.json({
    applied: changes.length,
    changes: changes.slice(0, 100),
    affectedShots,
    unknownShots,
    badLines,
    rowsParsed: rows.length,
  });
}
