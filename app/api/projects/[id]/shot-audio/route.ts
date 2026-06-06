/**
 * /api/projects/[id]/shot-audio · v9.7.1 (阶段十六 T1 · 让口型真渲染自动取音)
 *
 * 把每个对白镜的台词经 TTS 合成 → persistAsset 落盘 → 存 `project_assets type='shot-audio'`
 * (shot_number 索引,prosody 随情绪走 v2.9)。口型 render 端点据此自动取音,不再要调用方传 audioUrl。
 *
 * GET  → 已合成的镜号清单。
 * POST → 合成全片对白配音(覆盖式)。无 TTS 引擎(缺 MINIMAX_API_KEY)→ 200 {configured:false} + 提示。
 */
import { NextResponse } from 'next/server';
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { deriveProsody } from '@/lib/tts-prosody';
import { buildVoiceRouting } from '@/lib/voice-routing';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../../auth/lib';
import { recordCostLog, estimateTtsCostCny } from '@/lib/repos/cost-log-repo';
import type { ScriptShot } from '@/types/agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_VOICE = 'narrator_male_cn';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await listAssetsByType(id, 'shot-audio');
  const shots = rows.map((r) => r.shot_number).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b);
  return NextResponse.json({ count: shots.length, shots });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { voiceId?: string };
  // body.voiceId → 全片统一(back-compat);否则按角色路由(v9.7.4)
  const forceVoice = (body.voiceId || '').trim();

  // 成本记账用 userId(token 优先,否则首个用户)
  let userId = getUserFromRequest(request)?.sub || null;
  if (!userId) {
    const first = await getDbDriver().get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', []);
    userId = first?.id || null;
  }

  const scriptRows = await listAssetsByType(id, 'script');
  let script: { shots?: ScriptShot[] } = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shots: ScriptShot[] = Array.isArray(script.shots) ? script.shots : [];
  const dialogueShots = shots.filter((s) => (s.dialogue || '').trim());
  if (!dialogueShots.length) return NextResponse.json({ ok: false, message: '无对白镜 —— 无需合成配音' });

  // 角色 → 音色路由(首次出现顺序 + 性别池轮转,稳定互异);forceVoice 时不用
  const routing = forceVoice ? null : buildVoiceRouting(dialogueShots.map((s) => (s.characters?.[0] || '')));

  await import('@/lib/tts-providers/builtins'); // 副作用:注册内置 TTS provider
  const { dispatchTTSGenerate } = await import('@/lib/tts-providers/registry');

  await deleteAssetsByType(id, 'shot-audio'); // 覆盖式重合成
  let synthesized = 0;
  const results: Array<{ shotNumber: number; ok: boolean; audioUrl?: string; error?: string }> = [];

  for (const s of dialogueShots) {
    try {
      const speaker = (s.characters?.[0] || '').trim();
      const voiceId = forceVoice || routing?.get(speaker) || DEFAULT_VOICE;
      const prosody = deriveProsody({ emotion: s.emotion, emotionTemperature: s.emotionTemperature });
      const r = await dispatchTTSGenerate({ text: s.dialogue!, voiceId, language: 'zh-CN', speed: prosody.speed, pitch: prosody.pitch });
      if (!r.result) { results.push({ shotNumber: s.shotNumber, ok: false, error: 'no-engine' }); continue; }
      const p = await persistAsset(r.result.audioUrl, { ext: '.mp3', contentType: 'audio/mpeg' });
      if (!p) { results.push({ shotNumber: s.shotNumber, ok: false, error: 'persist-failed' }); continue; }
      await createAsset({
        projectId: id, type: 'shot-audio', name: `配音 · 镜 ${s.shotNumber}`,
        data: { text: s.dialogue, durationSec: r.result.duration, provider: r.result.provider, voiceId, speaker: speaker || undefined },
        mediaUrls: [p.url], shotNumber: s.shotNumber, version: 1,
      });
      synthesized++;
      results.push({ shotNumber: s.shotNumber, ok: true, audioUrl: p.url });
      // v9.7.2 成本记账(T3 自动归类 tts);失败不阻断
      await recordCostLog({
        userId, projectId: id, engine: `tts-${r.result.provider}`,
        durationSec: r.result.duration,
        costCny: estimateTtsCostCny(r.result.duration, (s.dialogue || '').length),
        metadata: { kind: 'shot-audio', shotNumber: s.shotNumber, voiceId },
      });
    } catch (e) {
      results.push({ shotNumber: s.shotNumber, ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  if (synthesized === 0) {
    return NextResponse.json({
      ok: false, configured: false,
      message: 'TTS 无可用引擎(需配 MINIMAX_API_KEY)或全部失败 —— 配音密钥只走 env',
      results,
    });
  }
  return NextResponse.json({ ok: true, synthesized, total: dialogueShots.length, results });
}
