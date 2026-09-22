/**
 * lib/ref-video-ingest — 上传的参考视频:探测 → 必要时截取前 15 秒 → 校验 → 落盘。v12.448。仅服务端。
 *
 * 校验在入库时就做完,而不是等出片时让 MiniMax 拒:那时可能已是深夜的定时重跑,
 * 用户看到的只是一句「参考视频被忽略」,不知道是文件本身不合格。
 *
 * 读写一律异步:文件最大 50MB,同步读写会把整个进程的事件循环卡住几百毫秒,
 * 两个上传叠在一起时所有路由(含健康检查)都没响应(对抗复查第三轮挖出)。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { checkRefVideo, REF_VIDEO_LIMITS, type RefVideoProbe } from './ref-video';

const execFileAsync = promisify(execFile);

export const REF_VIDEO_MIMES: Record<string, string> = { 'video/mp4': '.mp4', 'video/quicktime': '.mov' };

async function binaries() {
  const vc = await import('@/services/video-composer');
  return { ffmpeg: vc.resolveFFmpegPath(), ffprobe: vc.resolveFFprobePath() };
}

/**
 * 服务器自身的故障:缺 ffprobe/ffmpeg、处理超时、存储写不进。**不是用户文件的问题** ——
 * 第四轮复查挖出:原来一律当「文件损坏」回 422,部署漏装 ffprobe 时每个用户都会被告知自己的文件坏了,
 * 去反复转码一个好文件。
 */
export class RefVideoServerError extends Error {}

/** execFile 的失败:进程没起来(code 是字符串,如 ENOENT/EACCES)或被超时杀掉 → 服务器的问题;正常跑完但退出码非 0 → 文件的问题 */
function isToolFault(e: unknown): boolean {
  const err = e as { code?: unknown; killed?: boolean; signal?: unknown };
  return typeof err?.code === 'string' || err?.killed === true || (err?.signal != null && err?.code == null);
}

/** ffprobe 读时长/尺寸/帧率/大小/容器/编码;文件读不出 → null;ffprobe 自己跑不起来 → 抛 RefVideoServerError */
export async function probeRefVideo(file: string): Promise<RefVideoProbe | null> {
  try {
    const { ffprobe } = await binaries();
    const { stdout } = await execFileAsync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000 });
    const j = JSON.parse(stdout);
    const v = (j.streams || []).find((s: any) => s.codec_type === 'video');
    if (!v) return null;
    const m = String(v.avg_frame_rate || v.r_frame_rate || '').match(/^(\d+)\/(\d+)$/);
    const fps = m && Number(m[2]) > 0 ? Math.round((Number(m[1]) / Number(m[2])) * 1000) / 1000 : null;
    return {
      durationSec: Number(j.format?.duration) || Number(v.duration) || 0,
      width: Number(v.width) || 0,
      height: Number(v.height) || 0,
      fps: fps && Number.isFinite(fps) ? fps : null,
      sizeBytes: j.format?.size ? Number(j.format.size) : (await fs.promises.stat(file)).size,
      formatName: j.format?.format_name || null,
      codec: v.codec_name || null,
    };
  } catch (e) {
    if (isToolFault(e)) {
      console.error('[ref-video] ffprobe 无法运行:', e instanceof Error ? e.message : e);
      throw new RefVideoServerError('服务器处理不了视频(缺少或无法运行 ffprobe),请联系部署方');
    }
    return null;
  }
}

export type IngestResult =
  | { ok: true; url: string; probe: RefVideoProbe; trimmedFrom?: number }
  | { ok: false; errors: string[]; /** true = 服务器自身故障(路由回 500),不是文件的问题 */ server?: true };

/**
 * 处理一段上传的参考视频。`persist` 注入是为了可测:生产里传 lib/asset-storage 的 persistAsset。
 * 超过 15 秒 → 截取前 15 秒(先 -c copy 不重编码;不行再重编码)并告诉调用方截了多少。
 */
export async function ingestRefVideo(
  buf: Buffer, mime: string,
  persist: (dataUri: string, hint: { contentType: string }) => Promise<{ url: string } | null>,
): Promise<IngestResult> {
  const ext = REF_VIDEO_MIMES[mime];
  if (!ext) return { ok: false, errors: [`不支持的文件类型 ${mime || '(未知)'},只收 MP4 / MOV`] };
  if (buf.length > REF_VIDEO_LIMITS.maxBytes) return { ok: false, errors: [`文件 ${(buf.length / 1048576).toFixed(1)}MB,超过 ${REF_VIDEO_LIMITS.maxBytes / 1048576}MB`] };

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ref-video-'));
  try {
    return await ingestIn(dir, buf, mime, ext, persist);
  } catch (e) {
    if (e instanceof RefVideoServerError) return { ok: false, errors: [e.message], server: true };
    throw e;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { /* 临时目录清不掉不影响结果 */ });
  }
}

async function ingestIn(
  dir: string, buf: Buffer, mime: string, ext: string,
  persist: (dataUri: string, hint: { contentType: string }) => Promise<{ url: string } | null>,
): Promise<IngestResult> {
  const src = path.join(dir, `src${ext}`);
  await fs.promises.writeFile(src, buf);
  const p1 = await probeRefVideo(src);
  if (!p1) return { ok: false, errors: ['读不出这段视频(文件损坏,或不是视频)'] };

  // 先不带体积校验看一遍:截取之后体积会变,体积留到截完再判
  const v1 = checkRefVideo({ ...p1, sizeBytes: null });
  if (!v1.ok) return { ok: false, errors: v1.errors };

  let file = src, probe = p1, trimmedFrom: number | undefined;
  if (v1.trimTo) {
    const { ffmpeg } = await binaries();
    const dst = path.join(dir, `trim${ext}`);
    try {
      await execFileAsync(ffmpeg, ['-y', '-i', src, '-t', String(v1.trimTo), '-c', 'copy', '-movflags', '+faststart', dst], { timeout: 60_000 });
    } catch (e1) {
      if (isToolFault(e1) && !(e1 as { killed?: boolean })?.killed) {
        console.error('[ref-video] ffmpeg 无法运行:', e1 instanceof Error ? e1.message : e1);
        throw new RefVideoServerError('服务器处理不了视频(缺少或无法运行 ffmpeg),请联系部署方');
      }
      // -c copy 在非关键帧处截可能失败 —— 退回重编码(更慢但一定能截)
      try {
        await execFileAsync(ffmpeg, ['-y', '-i', src, '-t', String(v1.trimTo), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', dst], { timeout: 180_000 });
      } catch (e2) {
        if (isToolFault(e2)) {
          console.error('[ref-video] ffmpeg 截取失败(服务器侧):', e2 instanceof Error ? e2.message : e2);
          throw new RefVideoServerError('服务器截取视频超时或出错,请稍后重试,或自己剪到 15 秒内再传');
        }
        return { ok: false, errors: ['截取前 15 秒失败,请自己剪短后再传'] };
      }
    }
    const p2 = await probeRefVideo(dst);
    if (!p2) return { ok: false, errors: ['截取前 15 秒失败,请自己剪短后再传'] };
    file = dst; probe = p2; trimmedFrom = p1.durationSec;
  }

  // 本地文件要转 base64 随请求发送 —— 按内联上限校验最终体积
  const finalSize = (await fs.promises.stat(file)).size;
  const v2 = checkRefVideo({ ...probe, sizeBytes: finalSize }, { inline: true });
  if (!v2.ok) return { ok: false, errors: v2.errors };

  const saved = await persist(`data:${mime};base64,${(await fs.promises.readFile(file)).toString('base64')}`, { contentType: mime });
  // 存储写不进(磁盘满 / 权限 / 对象存储不可用)是服务器的问题,不是这个文件的问题
  if (!saved?.url) throw new RefVideoServerError('保存失败(服务器存储出错),请稍后重试');
  return { ok: true, url: saved.url, probe: { ...probe, sizeBytes: finalSize }, ...(trimmedFrom ? { trimmedFrom } : {}) };
}
