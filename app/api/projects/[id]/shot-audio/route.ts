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
import { effectiveVoice } from '@/lib/voice-routing';
import { resolveAndPersistCast } from '@/lib/voice-cast';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../../auth/lib';
import { recordCostLog, estimateTtsCostCny } from '@/lib/repos/cost-log-repo';
import type { ScriptShot } from '@/types/agents';
import { requireProjectAccess } from '@/lib/auth-guard';
import { detectLanguage, ttsLangCode } from '@/lib/language-detect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):本 GET 此前无鉴权 —— 知道 projectId 即可读取他人项目数据。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const rows = await listAssetsByType(id, 'shot-audio');
  const shots = rows
    .filter((r) => typeof r.shot_number === 'number')
    .map((r) => {
      let audioUrl: string | undefined;
      try { const u = JSON.parse(r.media_urls || '[]'); audioUrl = Array.isArray(u) ? u[0] : undefined; } catch { /* ignore */ }
      let durationSec: number | undefined; let speaker: string | undefined;
      try { const d = JSON.parse(r.data || '{}'); durationSec = d?.durationSec; speaker = d?.speaker; } catch { /* ignore */ }
      return { shotNumber: r.shot_number as number, audioUrl, durationSec, speaker };
    })
    .sort((a, b) => a.shotNumber - b.shotNumber);
  return NextResponse.json({ count: shots.length, shots });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { voiceId?: string };
  // body.voiceId → 全片统一(back-compat);否则按角色路由(v9.7.4)
  const forceVoice = (body.voiceId || '').trim();

  // v12.233(对抗复检收尾):此前身份解析失败会赋 '__no_auth__' **然后继续往下跑** ——
  // 即匿名请求照样为整个项目逐镜调 MiniMax TTS。GET 有守卫而 POST 裸奔,读写鉴权不对称。
  // 现在:POST 是写操作 + 会花钱,要 edit 级守卫,拦下才谈记账。
  const _g = await requireProjectAccess(request, id, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const userId = _g.userId;

  const scriptRows = await listAssetsByType(id, 'script');
  let script: { shots?: ScriptShot[] } = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shots: ScriptShot[] = Array.isArray(script.shots) ? script.shots : [];
  const dialogueShots = shots.filter((s) => (s.dialogue || '').trim());
  if (!dialogueShots.length) return NextResponse.json({ ok: false, message: '无对白镜 —— 无需合成配音' });

  // 角色 → 音色路由(首次出现顺序 + 性别池轮转,稳定互异);forceVoice 时不用
  // v10.6.4: speaker 提取与 lib/voice-retake.loadDialogueShots 完全对齐(单数 character
  // 回退 + trim)—— 否则演示工程(单数字段)整集合成全落默认音色,retake 却走轮转,两路打架
  // v12.338:出片即**落定妆表**(角色→音色写盘)。此前这套分配只活在这一次请求里 ——
  // 而分配是按整集阵容轮转出来的,用户出片后一改剧本(加角色/删台词/改名),
  // 阵容顺序一变,后续单句重录拿到的就不再是成片里那把嗓子,且不会有任何报警。
  // 落盘后重录读表(lib/voice-retake),两边同一出处才谈得上一致。
  const routing = forceVoice ? null : await resolveAndPersistCast(id, dialogueShots.map((s) => ((s.characters?.[0] || (s as any).character || '') as string).trim()));
  // 用户手动覆盖(v9.7.7,优先级最高,仅次于 forceVoice)
  let overrides: Record<string, string> = {};
  try {
    const ovRows = await listAssetsByType(id, 'voice-overrides');
    overrides = JSON.parse(ovRows[0]?.data || '{}')?.overrides || {};
  } catch { overrides = {}; }

  await import('@/lib/tts-providers/builtins'); // 副作用:注册内置 TTS provider
  const { dispatchTTSGenerate } = await import('@/lib/tts-providers/registry');

  await deleteAssetsByType(id, 'shot-audio'); // 覆盖式重合成
  let synthesized = 0;
  const results: Array<{ shotNumber: number; ok: boolean; audioUrl?: string; error?: string }> = [];

  for (const s of dialogueShots) {
    try {
      const speaker = ((s.characters?.[0] || (s as any).character || '') as string).trim();
      const voiceId = effectiveVoice(speaker, { force: forceVoice || undefined, overrides, routing: routing || undefined });
      const prosody = deriveProsody({ emotion: s.emotion, emotionTemperature: s.emotionTemperature });
      // v12.311:此前硬编码 'zh-CN' —— 项目经 /localize 翻成日/英/韩后,
      // 「合成配音」仍以中文语种模式发给 TTS,发音混乱。按台词自检语种,
      // 与 lib/narration-synth.ts:129 同一口径(那处 v12.6.1 就修过,这条路径漏了)。
      const _lang = ttsLangCode(detectLanguage(s.dialogue!));
      const r = await dispatchTTSGenerate({ text: s.dialogue!, voiceId, language: _lang, speed: prosody.speed, pitch: prosody.pitch });
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
