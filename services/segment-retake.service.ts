/**
 * services/segment-retake — 镜内片段重拍的**执行层**(v12.315)。
 *
 * v12.314 落的是纯逻辑 `planSegmentRetake`(缝合计划);这里按计划真的去切、去缝。
 * 分层的理由:所有边界判断(引擎下限、帧对齐、总时长不变)都在纯函数里可测,
 * 这一层只剩「照计划执行 ffmpeg」,不再做任何算术 —— 一旦这里也开始算时长,
 * 就又会出现两套口径(本仓已经在转场/音色/时间轴上栽过五次)。
 *
 * ── v12.456:保留段**不是**字节拷贝,是一次高质量重编码 ─────────────────
 * v12.315 起这里写着「保留段是原片的字节拷贝,画质零损失」,README 也这么宣传。**不是真的**:
 * 切片那步没带 `-c copy`,fluent-ffmpeg 生成的是 `-ss 0 -i src -t 3 head.mp4` ——
 * 按 libx264 默认参数(crf 23)重编码了一遍:owner 实测码率 2.50 → 0.73 Mbps,本机复现前段 72 个
 * 视频包与原片相同的是 0 个。只有最后 concat 那一步是 `-c copy`,测试也只锁了那一步,于是缺口一直没人看见。
 * (`setStartTime` 也不是注释里说的「精确定位」—— 它生成的是 `-i` 之前的 `-ss`。)
 *
 * 也**做不成**真正的字节拷贝:`-c copy` 只能切在关键帧上,切点会被吸到最近的 GOP 边界,
 * 破坏 `totalAfterS === snap(shotDurationS, fps)` 这条核心不变量。
 * smart cut(整 GOP 拷贝 + 只重编码边界那一截)也试过,没选,原因:
 *   ① 两种编码器的 GOP 挤在一条轨里,共用第一段的 SPS/PPS 描述;实测 concat 时 DTS 在接缝处倒退。
 *      ffmpeg 自己能解,但网页播放器与硬解是否都认,本仓没有验证手段;
 *   ② AAC 一帧 1024 样本、48kHz 下 24fps 一帧 2000 样本,音频切在视频帧边界必须重编码;
 *   ③ 主出片路径(composeVideo)还会把每镜按 crf 20 再编码一遍,保留段那几个 GOP
 *      即使在这里拷得一字不差,到成片里也已经不是原字节了。
 *
 * 所以改成:**原片 + 补丁一趟 filter graph 解码 → trim 帧精确裁切 → concat → 只编码一次**。
 *   · 画面:libx264 crf 17(视觉无损档),分辨率、帧率(有理数原样,不取整)、SAR、色彩标记跟原片;
 *     像素格式统一 yuv420p(与合成器一致,浏览器只稳播 4:2:0 8bit);
 *   · 声音:整条按**原片**的采样率 / 声道 / 编码器重编码 —— 此前补丁被硬写成 44100/2,
 *     而 concat demuxer 按第一段(48000)声明整条轨,补丁的 880Hz 播出来成了 960Hz(本机复现);
 *   · 一次编码,没有分段 AAC 的起始填充,接缝处不再有 DTS 倒退。
 * 对外口径相应改为「保留段高质量重编码一次,视觉无损」,不再说字节拷贝 / 零损失。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { planSegmentRetake, type SegmentRetakePlan } from '@/lib/segment-retake';

export interface SegmentRetakeExecInput {
  /** 原镜本地文件路径 */
  sourcePath: string;
  /** 引擎生成出来的补丁素材(时长 = plan.generateDurationS) */
  patchPath: string;
  plan: SegmentRetakePlan;
  /** 输出目录;不传则自建临时目录(自建的会在失败时清掉,见 v12.313) */
  outputDir?: string;
}

export interface SegmentRetakeExecResult {
  outputPath: string;
  /** 缝合后实测时长 —— 由调用方与 plan.totalAfterS 核对 */
  measuredDurationS: number;
}

/**
 * 保留段的画质档位。17 是 x264 的视觉无损区间(16–18);合成器成片用的是 20,
 * 这里比它高一档,好让「重拍过的镜」在成片里与没重拍的镜分不出代际。
 */
export const RETAKE_VIDEO_CRF = '17';

/** 原片的编码参数 —— 输出一律按它来,补丁向它看齐 */
export interface SourceParams {
  width: number;
  height: number;
  /** 有理数原样保留:30000/1001 取整成 30,每秒就漂 0.03 帧 */
  fps: string;
  sar: string;
  /** -colorspace / -color_primaries / -color_trc / -color_range,原片有标记才透传 */
  colorOptions: string[];
  /** null = 原片没有音轨;输出也不加(补丁自带的声音丢弃,不在一镜中间凭空冒出两秒声音) */
  audio: null | { sampleRate: number; layout: string; encoder: string; bitrate: string };
}

/** 探测视频时长(复用 composer 的 ffprobe 口径,不另起一套) */
async function probeDuration(file: string): Promise<number> {
  const { probeVideoIntegrity } = await import('@/services/video-composer');
  const r = await probeVideoIntegrity(file);
  return r?.durationSec ?? 0;
}

/**
 * 取 fluent-ffmpeg,并确保它用的是 composer 解析出的那个 ffmpeg / ffprobe。
 * 此前只有 probeDuration 会加载 composer,而它排在所有切片之后 ——
 * 前面几步用的是 PATH 上碰到的那个 ffmpeg,没装系统 ffmpeg 的机器上直接找不到。
 */
async function loadFfmpeg() {
  await import('@/services/video-composer');   // 模块加载时 setFfmpegPath / setFfprobePath
  return (await import('fluent-ffmpeg')).default;
}

async function ffprobeStreams(file: string): Promise<any[]> {
  const ffmpeg = await loadFfmpeg();
  const meta = await new Promise<any>((resolve, reject) => {
    (ffmpeg as any).ffprobe(file, (err: unknown, data: unknown) => (err ? reject(err) : resolve(data)));
  });
  return Array.isArray(meta?.streams) ? meta.streams : [];
}

const RATIONAL = /^\d+(?:\/\d+)?$/;
const positiveRational = (s: unknown): string | null => {
  const t = String(s ?? '');
  if (!RATIONAL.test(t)) return null;
  const [n, d = '1'] = t.split('/');
  return Number(n) > 0 && Number(d) > 0 ? t : null;
};

/** 原片音频编码 → 同名编码器;不认识的回落 aac(mp4 里最稳) */
const AUDIO_ENCODERS: Record<string, string> = { aac: 'aac', mp3: 'libmp3lame', opus: 'libopus' };

async function probeSource(file: string): Promise<SourceParams> {
  const streams = await ffprobeStreams(file);
  const v = streams.find((s: any) => s.codec_type === 'video');
  if (!v) throw new Error(`原镜没有视频流:${file}`);
  const a = streams.find((s: any) => s.codec_type === 'audio');

  const tag = (flag: string, value: unknown) =>
    value && !/^(unknown|reserved|unspecified)$/i.test(String(value)) ? [flag, String(value)] : [];
  const sar = String(v.sample_aspect_ratio || '').replace(':', '/');

  let audio: SourceParams['audio'] = null;
  if (a) {
    const channels = Number(a.channels) || 2;
    const layout = String(a.channel_layout || '') || (channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels}c`);
    const bitrate = Math.max(Number(a.bit_rate) || 0, 128_000);   // 不低于原片,重编码一代才听不出
    audio = {
      sampleRate: Number(a.sample_rate) || 48_000,
      layout,
      encoder: AUDIO_ENCODERS[String(a.codec_name)] || 'aac',
      bitrate: String(bitrate),
    };
  }

  return {
    width: Number(v.width) || 1920,
    height: Number(v.height) || 1080,
    fps: positiveRational(v.avg_frame_rate) || positiveRational(v.r_frame_rate) || '24',
    sar: positiveRational(sar) || '1',
    colorOptions: [
      ...tag('-colorspace', v.color_space),
      ...tag('-color_primaries', v.color_primaries),
      ...tag('-color_trc', v.color_transfer),
      ...tag('-color_range', v.color_range),
    ],
    audio,
  };
}

/** 秒 → ffmpeg 时长字面量;微秒精度,与 trim/atrim 内部口径一致 */
const t = (s: number) => s.toFixed(6);

/**
 * 缝合用的 filter graph。只照抄 plan 的切点,不做任何时长推导。
 *
 * `trim` 作用在**解码后的帧**上,所以切点是帧精确的 —— 不存在 `-ss` 放在 `-i` 前后的问题。
 * 补丁先 `fps` 再 `trim`:先落到原片帧栅格上再裁,帧数恰好是 plan 要的那么多。
 */
export function buildStitchGraph(
  plan: SegmentRetakePlan,
  src: SourceParams,
  patchHasAudio: boolean,
): { filters: string[]; hasAudio: boolean } {
  const { width: w, height: h, fps, sar, audio } = src;
  const finish = `setpts=PTS-STARTPTS,setsar=${sar},format=yuv420p`;
  const aFmt = audio ? `aformat=sample_rates=${audio.sampleRate}:channel_layouts=${audio.layout}` : '';

  const filters: string[] = [];
  const pads: string[] = [];
  const keep = (name: string, fromS: number, toS: number) => {
    filters.push(`[0:v]trim=start=${t(fromS)}:end=${t(toS)},${finish}[${name}v]`);
    if (audio) filters.push(`[0:a]atrim=start=${t(fromS)}:end=${t(toS)},asetpts=PTS-STARTPTS,${aFmt}[${name}a]`);
    pads.push(audio ? `[${name}v][${name}a]` : `[${name}v]`);
  };

  if (plan.head) keep('head', plan.head.fromS, plan.head.toS);

  filters.push(
    `[1:v]fps=${fps},trim=start=${t(plan.trimFromS)}:end=${t(plan.trimToS)},`
    + `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,${finish}[patchv]`,
  );
  if (audio) {
    // 补丁没有音轨时补同长静音 —— 不把原片那两秒的声音垫回去(那是被换掉的那条 take 的声音)
    filters.push(patchHasAudio
      ? `[1:a]atrim=start=${t(plan.trimFromS)}:end=${t(plan.trimToS)},asetpts=PTS-STARTPTS,aresample=${audio.sampleRate},${aFmt}[patcha]`
      : `anullsrc=r=${audio.sampleRate}:cl=${audio.layout},atrim=start=${t(plan.trimFromS)}:end=${t(plan.trimToS)},asetpts=PTS-STARTPTS,${aFmt}[patcha]`);
  }
  pads.push(audio ? '[patchv][patcha]' : '[patchv]');

  if (plan.tail) keep('tail', plan.tail.fromS, plan.tail.toS);

  filters.push(`${pads.join('')}concat=n=${pads.length}:v=1:a=${audio ? 1 : 0}${audio ? '[catv][outa]' : '[catv]'}`);
  // v12.456.1:输出帧率必须显式钉在原片上。concat 的输出链路在部分 ffmpeg 构建上**不带帧率**
  // (CI 上的 ffmpeg-static Linux 版、johnvansickle 静态构建实测都是),ffmpeg 于是按默认 25fps
  // 出片:24fps 的 8 秒镜变成 199 帧、前后段整体错位(PSNR 21.5dB)。macOS 的 6.0 / 8.1 与
  // Ubuntu 6.1.1 恰好都把 24 带下去了,所以本地全绿、CI 才红。帧本来就落在原片栅格上,
  // 这一步不增删帧,只把帧率写死。
  filters.push(`[catv]fps=${fps}[outv]`);
  return { filters, hasAudio: !!audio };
}

/**
 * 按计划缝合:head + patch + tail,一趟编码。
 *
 * **不做任何时长算术** —— 切点全部取自 plan(已帧对齐)。
 * 这是本模块与 v12.314 的分工边界,测试会锁住它。
 */
export async function executeSegmentRetake(
  input: SegmentRetakeExecInput,
): Promise<SegmentRetakeExecResult> {
  const { sourcePath, patchPath, plan } = input;
  if (!plan?.ok) throw new Error(`片段重拍计划无效:${plan?.reason || '未知原因'}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`原镜文件不存在:${sourcePath}`);
  if (!fs.existsSync(patchPath)) throw new Error(`补丁素材不存在:${patchPath}`);

  const ownsTmp = !input.outputDir;
  const tmpDir = input.outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'seg-retake-'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const cleanup = () => {
    if (!ownsTmp) return;   // v12.313:调用方传进来的目录归调用方,无权删
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败不阻塞 */ }
  };

  try {
    const src = await probeSource(sourcePath);
    const patchHasAudio = (await ffprobeStreams(patchPath)).some((s: any) => s.codec_type === 'audio');
    const { filters, hasAudio } = buildStitchGraph(plan, src, patchHasAudio);

    const outputPath = path.join(tmpDir, `retaken-${plan.patchFromS.toFixed(2)}-${plan.patchToS.toFixed(2)}.mp4`);
    await encodeStitched(sourcePath, patchPath, filters, hasAudio, src, outputPath);

    const measuredDurationS = await probeDuration(outputPath);
    return { outputPath, measuredDurationS };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** 唯一的一次编码。画质档见 RETAKE_VIDEO_CRF;音频参数全部取自原片,不硬写 */
async function encodeStitched(
  sourcePath: string, patchPath: string, filters: string[], hasAudio: boolean,
  src: SourceParams, out: string,
): Promise<void> {
  const ffmpeg = await loadFfmpeg();
  const audioOptions = hasAudio && src.audio
    ? ['-map', '[outa]', '-c:a', src.audio.encoder, '-b:a', src.audio.bitrate, '-ar', String(src.audio.sampleRate)]
    : ['-an'];
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(sourcePath)
      .input(patchPath)
      .complexFilter(filters)
      .outputOptions([
        '-map', '[outv]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', RETAKE_VIDEO_CRF, '-pix_fmt', 'yuv420p',
        ...src.colorOptions,
        ...audioOptions,
        '-movflags', '+faststart',
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** 便捷入口:先算计划再执行(计划不通过时直接把人话原因抛出去)。 */
export async function planAndExecute(
  args: Parameters<typeof planSegmentRetake>[0] & Omit<SegmentRetakeExecInput, 'plan'>,
): Promise<SegmentRetakeExecResult & { plan: SegmentRetakePlan }> {
  const plan = planSegmentRetake(args);
  if (!plan.ok) throw new Error(plan.reason || '片段重拍计划无效');
  const r = await executeSegmentRetake({ ...args, plan });
  return { ...r, plan };
}
