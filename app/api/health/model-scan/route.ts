/**
 * /api/health/model-scan (v10.6.3 模型雷达)
 *
 *   GET  扫描各 API 支持的最新模型(只读,不改配置)→ 升级建议 + 不可扫清单 + 现行覆盖
 *   POST {apply: true, modules?: string[]} 应用升级:LLM 候选先 1-token 实测,
 *        过了才写 model_overrides + process.env(免重启生效);视频等不可实测的
 *        按列表确认采用(首发时验证,失败走 fallback 链)。需登录。
 *   POST {rollback: '<ENV_KEY>'} 回滚一条覆盖到最初基线。需登录。
 *
 * key 永不回传;只动模型 ID,不碰密钥。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { scanLatestModels, verifyChatModel, MODULE_TARGETS } from '@/lib/model-scan';
import { applyModelOverride, rollbackModelOverride, listModelOverrides } from '@/lib/model-overrides';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await scanLatestModels();
  const overrides = await listModelOverrides();
  return NextResponse.json({ ...report, overrides });
}

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));

  // 回滚一条
  if (typeof body?.rollback === 'string' && body.rollback) {
    const ok = await rollbackModelOverride(body.rollback);
    return NextResponse.json({ ok, rolledBack: ok ? body.rollback : null });
  }

  if (body?.apply !== true) return NextResponse.json({ message: '缺 apply:true 或 rollback' }, { status: 400 });
  const onlyModules: string[] | null = Array.isArray(body.modules) ? body.modules : null;

  const report = await scanLatestModels();
  const applied: Array<{ module: string; envKey: string; from: string; to: string; verified: boolean }> = [];
  const skipped: Array<{ module: string; reason: string }> = [];

  for (const r of report.results) {
    if (r.status !== 'upgrade' || !r.latest) continue;
    if (onlyModules && !onlyModules.includes(r.module)) continue;
    const target = MODULE_TARGETS.find((t) => t.module === r.module)!;
    // 护栏 3:chat LLM 候选 1-token 实测,失败不采用
    let verified = false;
    if (target.verifiable) {
      verified = await verifyChatModel(target.source, r.latest);
      if (!verified) {
        skipped.push({ module: r.module, reason: `候选 ${r.latest} 实测未通过,维持 ${r.current}` });
        continue;
      }
    }
    await applyModelOverride(r.envKey, r.latest);
    applied.push({ module: r.module, envKey: r.envKey, from: r.current, to: r.latest, verified });
  }

  const overrides = await listModelOverrides();
  return NextResponse.json({ ok: true, applied, skipped, overrides, scannedAt: report.scannedAt });
}
