/**
 * 阶段三十 v12.38.0 — 剪映(JianYing)草稿导出(纯映射,可单测)。
 *
 * 把成片各镜 + 配音 + BGM + 字幕映射成剪映 `draft_content.json`(视频/音频/文本轨 + 素材表),
 * 国内短剧团队可直接在剪映里二剪,不必逐条手动导入。竞品调研里 ArcReel 等的「剪映草稿导出」即此。
 *
 * 诚实边界(务必读):
 *  - 剪映 6+ 对 draft_content.json **加密**,本导出仅适配 **剪映 5.9 及以下**(社区 pyJianYingDraft 同口径)。
 *  - 草稿引用的是**本地素材路径**;成片素材是 URL → 真导入前需把素材下载到本地并把 `path` 指向本地文件。
 *  - 剪映 schema 系社区逆向、随版本漂移;本映射覆盖核心字段(画布/帧率/时长/轨道/时间码),
 *    **导入前请在真剪映里验证**(本环境无剪映,无法做导入级验证;纯映射结构有单测)。
 *  - 时间单位:剪映内部用**微秒**。
 */

const US = 1_000_000;
const toUs = (sec: number) => Math.max(0, Math.round((Number(sec) || 0) * US));

/** 确定性 UUID 形 id(便于单测 + 满足剪映 id 形态)。 */
function genId(kind: string, i: number): string {
  const hex = (Math.abs(hashStr(kind)) + i).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}
function hashStr(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }

export interface JyClip { name?: string; path: string; durationSec: number; width?: number; height?: number }
export interface JyAudio { path: string; startSec: number; durationSec: number; name?: string }
export interface JySubtitle { text: string; startSec: number; durationSec: number }

export interface BuildJianYingInput {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  clips: JyClip[];                 // 视频镜头(按序排上视频轨)
  voiceovers?: JyAudio[];          // 配音(各镜起点对齐,排音频轨)
  bgm?: { path: string; durationSec?: number };
  subtitles?: JySubtitle[];        // 字幕(文本轨)
}

/** 纯函数:构造剪映 draft_content.json 对象。结构对齐社区 schema(剪映 ≤5.9)。 */
export function buildJianYingDraft(input: BuildJianYingInput): Record<string, unknown> {
  const width = input.width || 1920;
  const height = input.height || 1080;
  const fps = input.fps || 30;
  const clips = input.clips || [];

  const videos: Array<Record<string, unknown>> = [];
  const audios: Array<Record<string, unknown>> = [];
  const texts: Array<Record<string, unknown>> = [];

  const videoSegments: Array<Record<string, unknown>> = [];
  let cursorUs = 0;
  clips.forEach((c, i) => {
    const matId = genId('video', i);
    const durUs = toUs(c.durationSec || 5);
    videos.push({ id: matId, type: 'video', material_name: c.name || `shot-${i + 1}`, path: c.path, duration: durUs, width: c.width || width, height: c.height || height });
    videoSegments.push({
      id: genId('vseg', i), material_id: matId,
      target_timerange: { start: cursorUs, duration: durUs },
      source_timerange: { start: 0, duration: durUs },
      speed: 1.0, volume: 1.0, visible: true, render_index: i, extra_material_refs: [], clip: { alpha: 1.0 },
    });
    cursorUs += durUs;
  });
  const totalUs = cursorUs;

  const audioSegments: Array<Record<string, unknown>> = [];
  (input.voiceovers || []).forEach((a, i) => {
    const matId = genId('audio', i);
    const durUs = toUs(a.durationSec);
    audios.push({ id: matId, type: 'extract_music', name: a.name || `vo-${i + 1}`, path: a.path, duration: durUs });
    audioSegments.push({ id: genId('aseg', i), material_id: matId, target_timerange: { start: toUs(a.startSec), duration: durUs }, source_timerange: { start: 0, duration: durUs }, speed: 1.0, volume: 1.0 });
  });

  const bgmSegments: Array<Record<string, unknown>> = [];
  if (input.bgm?.path) {
    const matId = genId('bgm', 0);
    const durUs = toUs(input.bgm.durationSec || (totalUs / US));
    audios.push({ id: matId, type: 'music', name: 'BGM', path: input.bgm.path, duration: durUs });
    bgmSegments.push({ id: genId('bgmseg', 0), material_id: matId, target_timerange: { start: 0, duration: totalUs || durUs }, source_timerange: { start: 0, duration: durUs }, speed: 1.0, volume: 0.3 });
  }

  const textSegments: Array<Record<string, unknown>> = [];
  (input.subtitles || []).forEach((s, i) => {
    const matId = genId('text', i);
    texts.push({ id: matId, type: 'text', content: s.text, font_size: 8 });
    textSegments.push({ id: genId('tseg', i), material_id: matId, target_timerange: { start: toUs(s.startSec), duration: toUs(s.durationSec) }, render_index: i });
  });

  const tracks: Array<Record<string, unknown>> = [{ type: 'video', attribute: 0, flag: 0, segments: videoSegments }];
  if (audioSegments.length) tracks.push({ type: 'audio', attribute: 0, flag: 0, segments: audioSegments });
  if (bgmSegments.length) tracks.push({ type: 'audio', attribute: 0, flag: 0, segments: bgmSegments });
  if (textSegments.length) tracks.push({ type: 'text', attribute: 0, flag: 0, segments: textSegments });

  return {
    id: genId('draft', 0),
    name: input.name || 'Wind Comic 导出',
    duration: totalUs,
    fps,
    canvas_config: { width, height, ratio: 'original' },
    platform: { os: 'windows', app_version: '5.9.0' },
    version: 360000,
    materials: { videos, audios, texts, stickers: [], effects: [], transitions: [] },
    tracks,
  };
}

/** 配套 draft_meta_info.json(剪映需要;最小可用)。 */
export function buildJianYingMeta(name: string, draftId: string, totalUs: number): Record<string, unknown> {
  return { draft_id: draftId, draft_name: name, draft_fold_path: '', tm_duration: totalUs, draft_removable: true };
}
