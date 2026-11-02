/**
 * 成片体检报告(v12.153.0,ffprobe 全维,零生图 API)。
 *
 * 与 audio-health(单维:音频流)互补,这里出**全维结构化报告**:
 *   探测(probeMediaFull,ffprobe json)→ 判定(buildFilmHealthReport,纯函数可单测)
 * 维度:成片存在性 / 分辨率与项目画幅匹配 / 时长 vs 剧本预期 / 帧率 / 码率 /
 *       音频流 / 每镜视频完整度(缺镜、animatic 降级镜)。
 * 判定只依赖注入的探测结果 —— ffprobe 失败的维度诚实标 unknown,不猜。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { aspectToRatio } from './image-aspect-guard';
import { resolveFFprobePath } from './ffmpeg-bin';

const execFileAsync = promisify(execFile);

export interface MediaProbe {
  width: number;
  height: number;
  durationSec: number;
  fps: number | null;
  bitrateKbps: number | null;
  hasAudio: boolean;
  sizeBytes: number | null;
}

/** ffprobe 全维探测;文件不存在/probe 失败 → null。 */
export async function probeMediaFull(pathOrUrl: string): Promise<MediaProbe | null> {
  try {
    const { stdout } = await execFileAsync(resolveFFprobePath(), [
      '-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', pathOrUrl,
    ], { timeout: 30_000 });
    const j = JSON.parse(stdout);
    const v = (j.streams || []).find((s: any) => s.codec_type === 'video');
    if (!v) return null;
    const a = (j.streams || []).find((s: any) => s.codec_type === 'audio');
    const fpsRaw = String(v.avg_frame_rate || v.r_frame_rate || '');
    const fpsM = fpsRaw.match(/^(\d+)\/(\d+)$/);
    const fps = fpsM && Number(fpsM[2]) > 0 ? Number(fpsM[1]) / Number(fpsM[2]) : null;
    return {
      width: Number(v.width) || 0,
      height: Number(v.height) || 0,
      durationSec: Number(j.format?.duration) || 0,
      fps: fps && Number.isFinite(fps) ? Math.round(fps * 100) / 100 : null,
      bitrateKbps: j.format?.bit_rate ? Math.round(Number(j.format.bit_rate) / 1000) : null,
      hasAudio: !!a,
      sizeBytes: j.format?.size ? Number(j.format.size) : null,
    };
  } catch { return null; }
}

export type HealthStatus = 'ok' | 'warn' | 'fail' | 'unknown';
export interface HealthItem { key: string; label: string; status: HealthStatus; detail: string }
export interface FilmHealthReport {
  overall: HealthStatus;
  items: HealthItem[];
}

export interface FilmHealthInput {
  finalProbe: MediaProbe | null;       // 成片探测(null = 无成片或探测失败)
  hasFinalAsset: boolean;              // 成片资产是否存在(区分「没有成片」与「探测失败」)
  projectAspect: string;               // 项目画幅('9:16' 等)
  expectedDurationSec: number | null;  // 剧本预期总时长(shots duration 求和;null = 未知)
  shotTotal: number;                   // 剧本镜数
  shotWithVideo: number;               // 有视频资产的镜数
  animaticShots: number[];             // 降级镜号
}

/** 纯判定:探测结果 → 红黄绿报告。 */
export function buildFilmHealthReport(input: FilmHealthInput): FilmHealthReport {
  const items: HealthItem[] = [];
  const p = input.finalProbe;

  // ① 成片存在
  if (!input.hasFinalAsset) {
    items.push({ key: 'final', label: '成片', status: 'fail', detail: '还没有成片 —— 在镜头工坊或主管线完成剪辑合成' });
  } else if (!p) {
    items.push({ key: 'final', label: '成片', status: 'unknown', detail: '成片存在但探测失败(文件可能已被清理,重新合成可恢复)' });
  } else {
    items.push({ key: 'final', label: '成片', status: 'ok', detail: `${p.width}x${p.height} · ${p.durationSec.toFixed(1)}s${p.sizeBytes ? ` · ${(p.sizeBytes / 1024 / 1024).toFixed(1)}MB` : ''}` });
  }

  if (p) {
    // ② 画幅匹配
    const target = aspectToRatio(input.projectAspect);
    if (target && p.width > 0 && p.height > 0) {
      const actual = p.width / p.height;
      const drift = Math.abs(actual - target) / target;
      items.push(drift > 0.1
        ? { key: 'aspect', label: '画幅', status: 'fail', detail: `成片 ${p.width}x${p.height} 与项目 ${input.projectAspect} 不符(偏差 ${(drift * 100).toFixed(0)}%)` }
        : { key: 'aspect', label: '画幅', status: 'ok', detail: `${input.projectAspect} 匹配` });
    }

    // ③ 时长 vs 剧本预期(±25% 容差;animatic/转场会有出入)
    if (input.expectedDurationSec && input.expectedDurationSec > 0) {
      const ratio = p.durationSec / input.expectedDurationSec;
      items.push(ratio < 0.75 || ratio > 1.25
        ? { key: 'duration', label: '时长', status: 'warn', detail: `成片 ${p.durationSec.toFixed(1)}s,剧本预期 ~${input.expectedDurationSec}s(偏差较大,可能有镜未进片)` }
        : { key: 'duration', label: '时长', status: 'ok', detail: `${p.durationSec.toFixed(1)}s(预期 ~${input.expectedDurationSec}s)` });
    }

    // ④ 帧率
    if (p.fps != null) {
      items.push(p.fps < 20
        ? { key: 'fps', label: '帧率', status: 'warn', detail: `${p.fps}fps 偏低(<20),观感可能卡顿` }
        : { key: 'fps', label: '帧率', status: 'ok', detail: `${p.fps}fps` });
    }

    // ⑤ 码率(720p+ 低于 800kbps 通常糊)
    if (p.bitrateKbps != null) {
      items.push(p.bitrateKbps < 800
        ? { key: 'bitrate', label: '码率', status: 'warn', detail: `${p.bitrateKbps}kbps 偏低,画面可能明显压缩` }
        : { key: 'bitrate', label: '码率', status: 'ok', detail: `${p.bitrateKbps}kbps` });
    }

    // ⑥ 音频
    items.push(p.hasAudio
      ? { key: 'audio', label: '音轨', status: 'ok', detail: '含音频流' }
      : { key: 'audio', label: '音轨', status: 'fail', detail: '成片无音频流 —— 去镜头工坊合成配音/配乐补音' });
  }

  // ⑦ 每镜完整度
  if (input.shotTotal > 0) {
    const missing = input.shotTotal - input.shotWithVideo;
    if (missing > 0) {
      items.push({ key: 'shots', label: '镜头完整度', status: 'warn', detail: `${missing}/${input.shotTotal} 镜还没有视频` });
    } else {
      items.push({ key: 'shots', label: '镜头完整度', status: 'ok', detail: `${input.shotTotal} 镜视频齐全` });
    }
  }
  // ⑧ 降级镜
  if (input.animaticShots.length > 0) {
    items.push({ key: 'animatic', label: '降级镜', status: 'warn', detail: `S${input.animaticShots.join('、S')} 是 animatic 滞帧降级 —— 引擎恢复后可在视频区一键批量补渲` });
  }

  const overall: HealthStatus = items.some((i) => i.status === 'fail') ? 'fail'
    : items.some((i) => i.status === 'warn') ? 'warn'
    : items.some((i) => i.status === 'unknown') ? 'unknown' : 'ok';
  return { overall, items };
}
