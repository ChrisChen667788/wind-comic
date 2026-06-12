/**
 * lib/voice-retake (v10.6.4) — 配音 retake 工作流核心。
 *
 * 痛点:整集配音里只有一句不对味(情绪平了/读错重音),此前唯一出路是
 * POST /shot-audio 整集覆盖重合成 —— 慢、贵、且把已经满意的句子也赌进去。
 *
 * 三件套:
 *   - 台词级情绪标签:retake 时给单句换情绪(EMOTION_LABELS)→ deriveProsody
 *     直接出新 prosody,与剧本 shot.emotion 解耦
 *   - 单句重录不动整集:重录产物存 type='shot-audio-take' 历史行(独立 id,
 *     不碰 type='shot-audio' 活动行);「采用」才把 take 换入活动行(bumpVersion),
 *     其余镜的活动行零接触;下游 video(口型/成片)只把该镜置 stale
 *   - 版本对比试听:活动行 vs 任意 take,A/B 由前端双 <audio preload> 实现(<1s)
 *
 * 队列:批量重录走 pipeline_jobs type='voice-retake'(PIPELINE_QUEUE=1),
 * worker 按 type 派发到 runVoiceRetakeJob;不开队列时路由内同步顺序执行。
 * 整集覆盖重合成(deleteAssetsByType 'shot-audio')不删 take 历史 —— 版本留痕。
 */
import { nanoid } from 'nanoid';
import { db } from './db';
import {
  listAssetsByType, createAsset, getAsset, updateAsset, updateAssetBySelector, setAssetsStaleByShots,
} from './repos/asset-repo';
import { persistAsset } from './asset-storage';
import { deriveProsody, type ProsodyParams } from './tts-prosody';
import { buildVoiceRouting, effectiveVoice } from './voice-routing';
import { recordCostLog, estimateTtsCostCny } from './repos/cost-log-repo';

export const TAKE_TYPE = 'shot-audio-take';
export const ACTIVE_TYPE = 'shot-audio';

export interface DialogueShot {
  shotNumber: number;
  text: string;
  speaker: string;
  scriptEmotion: string;
  emotionTemperature?: number;
}

export interface RetakeInput {
  projectId: string;
  shotNumber: number;
  /** 台词级情绪标签(缺省用剧本 shot.emotion) */
  emotion?: string;
  emotionTemperature?: number;
  userId?: string | null;
}

export interface RetakeResult {
  ok: boolean;
  shotNumber: number;
  takeId?: string;
  audioUrl?: string;
  emotion?: string;
  prosody?: ProsodyParams;
  error?: string;
}

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** 对白镜清单:script 资产优先,缺了(如演示工程)回退 projects.script_data。 */
export async function loadDialogueShots(projectId: string): Promise<DialogueShot[]> {
  const rows = await listAssetsByType(projectId, 'script');
  let shots: any[] = parseJson(rows[0]?.data)?.shots;
  if (!Array.isArray(shots)) {
    const r = db.prepare('SELECT script_data FROM projects WHERE id = ?').get(projectId) as { script_data?: string } | undefined;
    shots = parseJson(r?.script_data)?.shots ?? [];
  }
  return shots
    .filter((s: any) => typeof s?.shotNumber === 'number' && (s.dialogue || '').trim())
    .map((s: any) => ({
      shotNumber: s.shotNumber,
      text: String(s.dialogue).trim(),
      // 演示工程用单数 character 字段,主链是 characters[]
      speaker: (s.characters?.[0] || s.character || '').trim(),
      scriptEmotion: (s.emotion || '').trim(),
      emotionTemperature: typeof s.emotionTemperature === 'number' ? s.emotionTemperature : undefined,
    }));
}

/** 音色解析 —— 与整集合成(shot-audio POST)同一优先级:手动覆盖 > 自动路由。 */
async function resolveVoice(projectId: string, speaker: string, dialogueShots: DialogueShot[]): Promise<string> {
  let overrides: Record<string, string> = {};
  const ovRows = await listAssetsByType(projectId, 'voice-overrides');
  overrides = parseJson(ovRows[0]?.data)?.overrides || {};
  // 路由必须按整集对白镜的首次出现顺序构建,单句重录才与整集音色一致
  const routing = buildVoiceRouting(dialogueShots.map((s) => s.speaker));
  return effectiveVoice(speaker, { overrides, routing });
}

/** 单句重录:合成 → 落 take 历史行。不碰活动行、不碰其他镜。 */
export async function synthesizeRetake(input: RetakeInput): Promise<RetakeResult> {
  const { projectId, shotNumber } = input;
  try {
    const dialogueShots = await loadDialogueShots(projectId);
    const shot = dialogueShots.find((s) => s.shotNumber === shotNumber);
    if (!shot) return { ok: false, shotNumber, error: '该镜无对白或不存在' };

    const emotion = (input.emotion || '').trim() || shot.scriptEmotion;
    const prosody = deriveProsody({ emotion, emotionTemperature: input.emotionTemperature ?? shot.emotionTemperature });
    const voiceId = await resolveVoice(projectId, shot.speaker, dialogueShots);

    await import('./tts-providers/builtins'); // 副作用:注册内置 TTS provider
    const { dispatchTTSGenerate } = await import('./tts-providers/registry');
    const r = await dispatchTTSGenerate({
      text: shot.text, voiceId, language: 'zh-CN', speed: prosody.speed, pitch: prosody.pitch,
    });
    if (!r.result) return { ok: false, shotNumber, error: 'TTS 无可用引擎(需配 MINIMAX_API_KEY)' };

    const p = await persistAsset(r.result.audioUrl, { ext: '.mp3', contentType: 'audio/mpeg' });
    if (!p) return { ok: false, shotNumber, error: '音频落盘失败' };

    const takeId = `take-${shotNumber}-${nanoid(8)}`;
    await createAsset({
      projectId, type: TAKE_TYPE, id: takeId,
      name: `重录 · 镜 ${shotNumber}`,
      data: {
        text: shot.text, emotion, prosody, voiceId,
        provider: r.result.provider, durationSec: r.result.duration,
        speaker: shot.speaker || undefined,
      },
      mediaUrls: [p.url], shotNumber, version: 1,
    });
    await recordCostLog({
      userId: input.userId ?? null, projectId, engine: `tts-${r.result.provider}`,
      durationSec: r.result.duration,
      costCny: estimateTtsCostCny(r.result.duration, shot.text.length),
      metadata: { kind: 'voice-retake', shotNumber, voiceId, emotion },
    });
    return { ok: true, shotNumber, takeId, audioUrl: p.url, emotion, prosody };
  } catch (e) {
    return { ok: false, shotNumber, error: e instanceof Error ? e.message : 'retake 失败' };
  }
}

/** 采用 take:换入该镜活动行(bumpVersion),其余镜零接触;下游 video 置 stale 待重渲。 */
export async function adoptTake(projectId: string, takeId: string): Promise<{
  ok: boolean; shotNumber?: number; audioUrl?: string; staleMarked?: number; error?: string;
}> {
  const take = await getAsset(takeId);
  if (!take || take.project_id !== projectId || take.type !== TAKE_TYPE || take.shot_number == null) {
    return { ok: false, error: 'take 不存在' };
  }
  const shotNumber = take.shot_number;
  const mediaUrls = parseJson(take.media_urls) || [];
  const data = { ...(parseJson(take.data) || {}), adoptedTakeId: takeId };

  const changed = await updateAssetBySelector(
    projectId, { type: ACTIVE_TYPE, shotNumber },
    { mediaUrls, data, bumpVersion: true },
  );
  if (changed === 0) {
    // 该镜还没合成过整集配音 → 直接建活动行
    await createAsset({
      projectId, type: ACTIVE_TYPE, name: `配音 · 镜 ${shotNumber}`,
      data, mediaUrls, shotNumber, version: 1,
    });
  }
  // 口型/成片随声音失效 —— 只动该镜
  const staleMarked = await setAssetsStaleByShots(projectId, ['video'], [shotNumber], true);
  // 口型-音频对齐分是整项目聚合行(shot_number=NULL,按镜标 stale 标不中)——
  // 精准摘掉该镜旧分:换了配音,旧对齐分已不可信,发布门禁不应再读到它
  try {
    const alignRows = await listAssetsByType(projectId, 'lipsync-align');
    for (const row of alignRows) {
      const d = parseJson(row.data) || {};
      if (d.scores && Object.prototype.hasOwnProperty.call(d.scores, String(shotNumber))) {
        delete d.scores[String(shotNumber)];
        await updateAsset(row.id, { data: d });
      }
    }
  } catch { /* 非关键路径 — 对齐分缺失只影响门禁展示 */ }
  return { ok: true, shotNumber, audioUrl: mediaUrls[0], staleMarked };
}

export interface RetakeShotState {
  shotNumber: number;
  text: string;
  speaker: string;
  scriptEmotion: string;
  activeUrl: string | null;
  activeEmotion: string | null;
  activeVersion: number | null;
  takes: Array<{ id: string; audioUrl: string | null; emotion: string; durationSec?: number; createdAt: string; adopted: boolean }>;
}

/** 面板数据:逐对白镜的活动版 + take 历史(新→旧)。 */
export async function listRetakeState(projectId: string): Promise<RetakeShotState[]> {
  const [dialogueShots, activeRows, takeRows] = await Promise.all([
    loadDialogueShots(projectId),
    listAssetsByType(projectId, ACTIVE_TYPE),
    listAssetsByType(projectId, TAKE_TYPE),
  ]);
  const activeByShot = new Map(activeRows.filter((r) => r.shot_number != null).map((r) => [r.shot_number as number, r]));

  return dialogueShots.map((s) => {
    const active = activeByShot.get(s.shotNumber);
    const activeData = parseJson(active?.data) || {};
    const takes = takeRows
      .filter((r) => r.shot_number === s.shotNumber)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((r) => {
        const d = parseJson(r.data) || {};
        return {
          id: r.id,
          audioUrl: (parseJson(r.media_urls) || [])[0] ?? null,
          emotion: d.emotion || '',
          durationSec: d.durationSec,
          createdAt: r.created_at,
          adopted: activeData.adoptedTakeId === r.id,
        };
      });
    return {
      shotNumber: s.shotNumber,
      text: s.text,
      speaker: s.speaker,
      scriptEmotion: s.scriptEmotion,
      activeUrl: (parseJson(active?.media_urls) || [])[0] ?? null,
      activeEmotion: activeData.emotion || null,
      activeVersion: active?.version ?? null,
      takes,
    };
  });
}

export interface VoiceRetakeJobPayload {
  projectId: string;
  shots: Array<{ shotNumber: number; emotion?: string; emotionTemperature?: number }>;
  userId?: string | null;
}

/**
 * 重录队列任务体(pipeline_jobs type='voice-retake',worker 按 type 派发)。
 * 逐句顺序执行(TTS 引擎本就限流),emit retakeProgress;全军覆没才发 error
 * (worker 据此判失败重试),部分成功算完成 —— 失败句留在面板上可单独再录。
 */
export async function runVoiceRetakeJob(
  payload: VoiceRetakeJobPayload,
  emit: (type: string, data: unknown) => void,
): Promise<void> {
  const shots = Array.isArray(payload?.shots) ? payload.shots : [];
  const results: RetakeResult[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const r = await synthesizeRetake({
      projectId: payload.projectId, shotNumber: s.shotNumber,
      emotion: s.emotion, emotionTemperature: s.emotionTemperature, userId: payload.userId,
    });
    results.push(r);
    emit('retakeProgress', { done: i + 1, total: shots.length, last: r });
  }
  const okCount = results.filter((r) => r.ok).length;
  if (shots.length > 0 && okCount === 0) {
    emit('error', { message: `批量重录全部失败:${results[0]?.error || '未知原因'}` });
    return;
  }
  emit('retakeDone', { ok: okCount, total: shots.length, results });
}
