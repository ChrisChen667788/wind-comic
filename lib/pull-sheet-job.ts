/**
 * lib/pull-sheet-job (v11.1.1) — 外部视频拆条 + 拉片任务体(pipeline_jobs type='pull-sheet')。
 *
 * 流程:参考片落盘(persistAsset)→ ffmpeg 场景切分(scene-split)→ 逐镜抽中帧
 * 入库存储 → 可选 Vision 逐镜打标(BYO:无 key / MOCK_ENGINES=1 → 跳过,骨架表
 * 诚实标注「镜头语言待打标」)→ PullSheet 落 project_assets type='pull-sheet'。
 *
 * 分层(BYO 哲学):零配置 = 确定性骨架(切点/时长/缩略图全真);配 Vision key =
 * 画面维度逐镜打标(白名单校验,声音列单帧无声不让 LLM 编)。打标失败逐镜降级骨架。
 */
import fs from 'fs';
import { persistAsset } from './asset-storage';
import { storagePut } from './storage';
import { createAsset } from './repos/asset-repo';
import {
  probeDurationSec, detectSceneCuts, splitToShots, extractFrameAt, MAX_SHOTS,
} from './scene-split';
import { validateVisionLabel, type PullSheet, type PullSheetShot } from './pull-sheet';
import { API_CONFIG } from './config';

export interface PullSheetJobPayload {
  projectId: string;
  videoUrl: string;
  name?: string;
  userId?: string | null;
}

const VISION_SYSTEM = `你是资深拉片分析师。给你一部短片中某一镜的代表帧,请按拉片五栏口径输出画面维度的分析。
只输出 JSON(不要 markdown 标记):
{
  "description": "画面内容一句话",
  "scene": "场景名(如:办公室/雨夜巷口)",
  "characters": ["画面中的人物描述"],
  "shotSize": "景别(远景/全景/中景/近景/特写)",
  "composition": "构图要点一句话",
  "cameraAngle": "机位角度(平视/俯拍/仰拍/过肩…)",
  "lens": "焦距与景深观感(广角深景深/长焦浅景深…)",
  "lightingIntent": "光影与色调一句话"
}
注意:这是单帧,运镜/剪辑/声音无法从静帧判断 —— 不要编造这些维度。`;

function visionEnabled(): boolean {
  const key = API_CONFIG.openai.apiKey;
  return !!key && !key.startsWith('your_') && process.env.MOCK_ENGINES !== '1';
}

/** 单帧 Vision 打标:白名单校验落地;任何失败 → null(该镜降级骨架)。 */
async function labelFrameWithVision(frameAbsPath: string): Promise<Partial<PullSheetShot> | null> {
  if (!visionEnabled()) return null;
  try {
    const buf = fs.readFileSync(frameAbsPath);
    const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: API_CONFIG.openai.apiKey, baseURL: API_CONFIG.openai.baseURL, timeout: 30_000 });
    const res = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      max_tokens: 500,
      messages: [
        { role: 'system', content: VISION_SYSTEM },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUri } }] as any },
      ],
    });
    const text = (res.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    const label = validateVisionLabel(parsed);
    return Object.keys(label).length ? label : null;
  } catch {
    return null;
  }
}

/**
 * 任务体:emit pullSheetProgress(瞬时,不入回放)/ pullSheetDone / error。
 * 重试 = 重跑(切分确定性,Vision 失败镜本就降级,幂等成本可接受)。
 */
export async function runPullSheetJob(
  payload: PullSheetJobPayload,
  emit: (type: string, data: unknown) => void,
): Promise<void> {
  const { projectId, videoUrl } = payload;

  const local = await persistAsset(videoUrl, { ext: '.mp4', contentType: 'video/mp4' });
  if (!local?.absPath || !fs.existsSync(local.absPath)) {
    emit('error', { message: '参考片下载/落盘失败 —— 确认 URL 可访问(http(s) 或站内 serve-file)' });
    return;
  }

  const duration = await probeDurationSec(local.absPath);
  if (!duration) {
    emit('error', { message: '无法读取视频时长(文件可能不是有效视频)' });
    return;
  }

  const cuts = await detectSceneCuts(local.absPath);
  const { shots: segs, truncated } = splitToShots(duration, cuts);
  emit('pullSheetProgress', { stage: 'split', total: segs.length, truncated });

  const useVision = visionEnabled();
  const shots: PullSheetShot[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    // 中帧最能代表一镜(与 extractMiddleFrame 同理)
    const framePath = await extractFrameAt(local.absPath, (seg.startSec + seg.endSec) / 2);
    let thumbnail: string | null = null;
    let label: Partial<PullSheetShot> | null = null;
    if (framePath) {
      try {
        const put = await storagePut(fs.readFileSync(framePath), 'image/jpeg', '.jpg');
        thumbnail = put.url;
        if (useVision) label = await labelFrameWithVision(framePath);
      } catch { /* 缩略图失败不阻断 */ }
      try { fs.unlinkSync(framePath); } catch { /* tmp 清理尽力 */ }
    }
    shots.push({
      shotNumber: seg.shotNumber,
      thumbnail,
      videoUrl: null,
      description: '', scene: '', characters: [], dialogue: '',
      durationSec: seg.durationSec, startSec: seg.startSec, endSec: seg.endSec,
      shotSize: '', composition: '', cameraAngle: '', cameraMovement: '', lens: '',
      lightingIntent: '', editPattern: '', scoreMood: '', soundDesign: '', diegeticSound: '',
      storyBeat: '', whyThisChoice: '',
      ...(label || {}),
      source: label ? 'vision' : 'skeleton',
    });
    emit('pullSheetProgress', { stage: 'label', done: i + 1, total: segs.length });
  }

  const labeled = shots.filter((s) => s.source === 'vision').length;
  const sheet: PullSheet = {
    title: payload.name || '外部参考片',
    shotCount: shots.length,
    totalDurationSec: duration,
    source: labeled > 0 ? 'vision' : 'skeleton',
    shots,
  };

  await createAsset({
    projectId, type: 'pull-sheet',
    name: payload.name || `参考片拉片 · ${shots.length} 镜`,
    data: { ...sheet, truncated, labeledShots: labeled, sourceVideoUrl: local.url },
    mediaUrls: [local.url],
  });

  emit('pullSheetDone', { shots: shots.length, labeled, truncated, source: sheet.source });
}
