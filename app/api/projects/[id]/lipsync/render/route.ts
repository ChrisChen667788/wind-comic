/**
 * /api/projects/[id]/lipsync/render · v9.7.0 (阶段十六 T1 口型真渲染)
 *
 * GET  → 口型引擎状态(是否配置 + 可用 provider 列表)。
 * POST → 把某镜「真渲染口型」:解析 说话人脸(分镜图)+ 配音音频 + viseme 轨 → 经
 *        lipsync-providers 调度引擎(wav2lip/SadTalker/...)产出对口型视频。
 *
 * 引擎未配置(无 LIPSYNC_API_URL)→ 200 `{configured:false}`(优雅,不报错,UI 提示如何启用)。
 * 缺脸 / 缺音 → 200 `{ok:false, message}`(可执行提示)。真实渲染消耗算力,留用户环境实测。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { listAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { getUserFromRequest } from '../../../../auth/lib';
import { recordCostLog, estimateLipsyncCostCny } from '@/lib/repos/cost-log-repo';
import { dialogueLinesFromShots, planVisemes } from '@/lib/lipsync-plan';
import {
  lipSyncEngineConfigured, listLipSyncProviders, dispatchLipSyncGenerate,
} from '@/lib/lipsync-providers';
import type { ScriptShot } from '@/types/agents';
import { requireUser, requireProjectAccess } from '@/lib/auth-guard';
import { recordPluginEvent } from '@/lib/plugin-chain-telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETUP_HINT = '口型引擎未配置 —— 设置 LIPSYNC_API_URL 指向自托管 wav2lip/SadTalker/MuseTalk 服务即可启用(可选 LIPSYNC_API_KEY 鉴权)';

export async function GET(request: Request) {
  // v12.230:只返回引擎能力信息(无项目数据),故不需要项目作用域守卫;
  // 但与 v12.218 给 health/providers 的处理一致 —— 要求登录,避免匿名探测基础设施配置。
  const _g = requireUser(request);
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const configured = lipSyncEngineConfigured();
  const providers = listLipSyncProviders().map((p) => ({ id: p.id, name: p.name, available: (() => { try { return p.available(); } catch { return false; } })() }));
  return NextResponse.json({ configured, providers, hint: configured ? undefined : SETUP_HINT });
}

function jsonArr(s: unknown): string[] {
  if (typeof s !== 'string' || !s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!lipSyncEngineConfigured()) {
    return NextResponse.json({ configured: false, ok: false, message: SETUP_HINT });
  }

  const body = (await request.json().catch(() => ({}))) as {
    shotNumber?: number; faceUrl?: string; audioUrl?: string;
    visemes?: Array<{ t: number; viseme: string; mouthOpen: number }>;
  };
  const d = getDbDriver();
  // v12.233(对抗复检收尾):此前身份解析失败赋 '__no_auth__' **然后继续执行** ——
  // 即匿名请求照样调用外部 Lipsync 服务(wav2lip/SadTalker)并计费。
  // GET 要登录而 POST 裸奔,读写鉴权不对称。POST 是写操作 + 花钱 → edit 级守卫。
  const _g = await requireProjectAccess(request, id, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const userId = _g.userId;

  // 1) 说话人脸:body 优先,否则取该镜分镜图
  let faceUrl = (body.faceUrl || '').trim();
  let faceIsVideo = false;
  if (!faceUrl && typeof body.shotNumber === 'number') {
    const sb = await d.get<any>(
      `SELECT media_urls FROM project_assets WHERE project_id = ? AND type = 'storyboard' AND shot_number = ? ORDER BY version DESC LIMIT 1`,
      [id, body.shotNumber],
    );
    faceUrl = jsonArr(sb?.media_urls)[0] || '';
  }
  if (!faceUrl) return NextResponse.json({ configured: true, ok: false, message: '缺说话人脸:先生成该镜分镜图,或显式传 faceUrl' });

  // 2) 配音音频:body 优先,否则自动取该镜 shot-audio 资产(v9.7.1)
  let audioUrl = (body.audioUrl || '').trim();
  if (!audioUrl && typeof body.shotNumber === 'number') {
    const sa = await d.get<any>(
      `SELECT media_urls FROM project_assets WHERE project_id = ? AND type = 'shot-audio' AND shot_number = ? ORDER BY version DESC LIMIT 1`,
      [id, body.shotNumber],
    );
    audioUrl = jsonArr(sa?.media_urls)[0] || '';
  }
  if (!audioUrl) return NextResponse.json({ configured: true, ok: false, message: '缺配音音频:先在面板「合成配音」(或传 audioUrl)' });

  // 3) viseme 轨:body 优先,否则从剧本该镜推
  let visemes = Array.isArray(body.visemes) ? body.visemes : undefined;
  if (!visemes && typeof body.shotNumber === 'number') {
    const rows = await listAssetsByType(id, 'script');
    let script: { shots?: ScriptShot[] } = {};
    try { script = JSON.parse(rows[0]?.data || '{}'); } catch { script = {}; }
    const line = dialogueLinesFromShots(Array.isArray(script.shots) ? script.shots : []).find((l) => l.shotNumber === body.shotNumber);
    if (line) visemes = planVisemes(line).map((f) => ({ t: f.t, viseme: f.viseme, mouthOpen: f.mouthOpen }));
  }

  // v12.352:口型这一路**一条遥测都没有** —— admin 的 plugin-stats 面板上
  // image/video/tts 三条曲线都在,lipsync 是空的,运维看不到它的成功率与耗时。
  //
  // 为什么不套 `withLipSyncPlugin`(迭代方案里那条):这里**没有「orchestrator 老路径」
  // 可作 fallback** —— lipsync 本来就是走注册表调度的,plugin 与 fallback 会是同一条,
  // 模式(off/shadow/primary)因此毫无意义;而且默认 mode 是 `off`,套上去连遥测都不产生。
  // 光加 wrapper 是花架子,真正缺的是**在真实调用点落账**,与 plugin mode 无关。
  const _lsT0 = Date.now();
  const { result, tried } = await dispatchLipSyncGenerate({ faceUrl, audioUrl, visemes, shotNumber: body.shotNumber, faceIsVideo });
  void recordPluginEvent({
    kind: 'lipsync',
    mode: 'primary',
    outcome: result ? 'primary_hit' : 'primary_fallback',
    provider: result?.provider || tried.find((t) => t.ok)?.id || null,
    latencyMs: Date.now() - _lsT0,
    error: result ? null : tried.map((t) => t.error).filter(Boolean).join(' | ').slice(0, 200),
  });
  if (!result) {
    return NextResponse.json({ configured: true, ok: false, message: '口型渲染失败(引擎链全失败)', tried }, { status: 502 });
  }

  // v9.7.2 写回成片管线:落盘 + 存为该镜 video 资产(新 updated_at → 时间线/分镜自动取最新口型版)。
  let videoUrl = result.videoUrl;
  let writtenBack = false;
  if (typeof body.shotNumber === 'number') {
    try {
      const p = await persistAsset(result.videoUrl, { ext: '.mp4', contentType: 'video/mp4' });
      if (p) videoUrl = p.url;
      await createAsset({
        projectId: id, type: 'video', name: `口型 · 镜 ${body.shotNumber}`,
        data: { source: 'lipsync', provider: result.provider, audioUrl, faceUrl, upstreamId: result.upstreamId },
        mediaUrls: [videoUrl], shotNumber: body.shotNumber, version: 1,
      });
      writtenBack = true;
    } catch { /* 写回失败不影响返回渲染结果 */ }
  }

  // v9.7.2 成本记账(T3 自动归类 lipsync);失败不阻断
  await recordCostLog({
    userId, projectId: id, engine: `lipsync-${result.provider}`,
    durationSec: result.durationSec,
    costCny: estimateLipsyncCostCny(result.estCostCny, result.durationSec),
    metadata: { kind: 'lipsync-render', shotNumber: body.shotNumber, provider: result.provider },
  });

  return NextResponse.json({ configured: true, ok: true, shotNumber: body.shotNumber, ...result, videoUrl, writtenBack, tried });
}
