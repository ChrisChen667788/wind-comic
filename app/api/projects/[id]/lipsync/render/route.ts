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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETUP_HINT = '口型引擎未配置 —— 设置 LIPSYNC_API_URL 指向自托管 wav2lip/SadTalker/MuseTalk 服务即可启用(可选 LIPSYNC_API_KEY 鉴权)';

export async function GET() {
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
  let userId = getUserFromRequest(request)?.sub || null;
  if (!userId) {
    const first = await d.get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', []);
    userId = first?.id || null;
  }

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

  const { result, tried } = await dispatchLipSyncGenerate({ faceUrl, audioUrl, visemes, shotNumber: body.shotNumber, faceIsVideo });
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
