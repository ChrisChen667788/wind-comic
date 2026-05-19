/**
 * v3.2 P3.3 — Pure helpers backing scripts/capture-gifs.mjs.
 *
 * 把 ffmpeg arg 生成 / frame list 拼接 / payload validation 抽到这里, 让 vitest
 * 能 fuzz 测试这些纯函数. 真正的 fs / spawn 留在 .mjs 脚本里.
 *
 * 测试: tests/v3-2-gif-pipeline.test.ts.
 */

export interface FrameInput {
  /** 帧 PNG bytes. 0 长度 / 空 buffer 会被 validateFrames 拒. */
  buffer: Uint8Array | Buffer;
  /** 该帧停留时长 (毫秒). 默认 100ms = 10fps. */
  durationMs?: number;
}

export interface FrameFileEntry {
  /** 该帧 PNG 落盘后的绝对路径. */
  path: string;
  /** 该帧停留时长 (秒). */
  durationSec: number;
}

export interface GifEncodeOptions {
  /** 输出 GIF 帧率. 默认 10. */
  fps?: number;
  /** 输出 GIF 宽度 (px). 高度按比例 (lanczos). */
  width?: number;
  /** palette dither 算法. 默认 bayer. */
  dither?: 'bayer' | 'sierra2' | 'none';
}

// ─── Input validation ─────────────────────────────────────────────────────

/**
 * Frame payload 校验. 通过的 input 才能往 ffmpeg pipeline 喂.
 * Fuzz 目标: 各种损坏的 frames 列表必须给清晰错误, 不要让 ffmpeg 静默挂掉.
 */
export function validateFrames(frames: unknown): asserts frames is FrameInput[] {
  if (!Array.isArray(frames)) {
    throw new Error('validateFrames: input is not an array');
  }
  if (frames.length === 0) {
    throw new Error('validateFrames: zero frames — cannot encode empty GIF');
  }
  if (frames.length > 10_000) {
    throw new Error(`validateFrames: too many frames (${frames.length}) — likely runaway capture loop`);
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as any;
    if (!f || typeof f !== 'object') {
      throw new Error(`validateFrames: frame[${i}] is not an object`);
    }
    const buf = f.buffer;
    if (!buf) {
      throw new Error(`validateFrames: frame[${i}] missing buffer`);
    }
    const isBuf =
      (typeof Buffer !== 'undefined' && buf instanceof Buffer) ||
      buf instanceof Uint8Array;
    if (!isBuf) {
      throw new Error(`validateFrames: frame[${i}].buffer is not Buffer/Uint8Array (got ${typeof buf})`);
    }
    if ((buf as Uint8Array).length === 0) {
      throw new Error(`validateFrames: frame[${i}].buffer is empty (0 bytes)`);
    }
    if (f.durationMs != null) {
      if (typeof f.durationMs !== 'number' || !Number.isFinite(f.durationMs)) {
        throw new Error(`validateFrames: frame[${i}].durationMs is not finite number`);
      }
      if (f.durationMs <= 0) {
        throw new Error(`validateFrames: frame[${i}].durationMs must be > 0 (got ${f.durationMs})`);
      }
      if (f.durationMs > 60_000) {
        throw new Error(`validateFrames: frame[${i}].durationMs > 60s — likely bug, refuse to encode`);
      }
    }
  }
}

// ─── concat demuxer list ──────────────────────────────────────────────────

/**
 * 生成 ffmpeg `-f concat -i <list.txt>` 的 list 文件内容.
 * 每帧两行: `file '<path>'` 和 `duration <seconds>`. 最后一帧必须重复一次 (concat
 * demuxer 已知行为, 否则最后一帧 duration 会被丢).
 *
 * 输入是已落盘的 frame paths, 没 fs 副作用.
 */
export function buildConcatList(frameFiles: FrameFileEntry[]): string {
  if (frameFiles.length === 0) {
    throw new Error('buildConcatList: empty frameFiles');
  }
  for (const f of frameFiles) {
    if (!f.path || typeof f.path !== 'string') {
      throw new Error('buildConcatList: frame entry missing path');
    }
    if (f.path.includes("'")) {
      // ffmpeg concat-list 用单引号分割, path 含 ' 会破坏语法.
      // 这是脚本运行环境的硬约束 — frame 应该都在 /tmp, 不会出现 ' 但兜底.
      throw new Error(`buildConcatList: path contains single quote: ${f.path}`);
    }
    if (!Number.isFinite(f.durationSec) || f.durationSec <= 0) {
      throw new Error(`buildConcatList: invalid durationSec=${f.durationSec} for ${f.path}`);
    }
  }
  const lines: string[] = [];
  for (const f of frameFiles) {
    lines.push(`file '${f.path}'`);
    lines.push(`duration ${f.durationSec.toFixed(3)}`);
  }
  // 最后一帧重复一次, 否则 ffmpeg 丢这帧的 duration
  lines.push(`file '${frameFiles[frameFiles.length - 1].path}'`);
  return lines.join('\n');
}

// ─── ffmpeg arg builders ──────────────────────────────────────────────────

/** clamp & sanitize encode options. */
function sanitizeOpts(opts: GifEncodeOptions = {}): Required<GifEncodeOptions> {
  const fps = Math.max(1, Math.min(60, Math.round(opts.fps ?? 10)));
  const width = Math.max(64, Math.min(4096, Math.round(opts.width ?? 960)));
  const dither = opts.dither === 'sierra2' || opts.dither === 'none' ? opts.dither : 'bayer';
  return { fps, width, dither };
}

/** ffmpeg args 生成 palette.png. listFile / palettePath 由调用方落盘. */
export function paletteGenArgs(listFile: string, palettePath: string, opts: GifEncodeOptions = {}): string[] {
  const { fps, width } = sanitizeOpts(opts);
  return [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=full`,
    palettePath,
  ];
}

/** ffmpeg args 用 palette 出 GIF. */
export function paletteUseArgs(
  listFile: string,
  palettePath: string,
  outFile: string,
  opts: GifEncodeOptions = {},
): string[] {
  const { fps, width, dither } = sanitizeOpts(opts);
  const ditherSpec =
    dither === 'sierra2' ? 'sierra2' :
    dither === 'none'    ? 'none' :
                            'bayer:bayer_scale=5';
  return [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-i', palettePath,
    '-filter_complex',
      `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=${ditherSpec}`,
    '-loop', '0',
    outFile,
  ];
}
