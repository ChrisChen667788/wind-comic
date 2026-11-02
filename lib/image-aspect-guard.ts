/**
 * 图像画幅守门(v12.148.0,草图锁全片实测发现)。
 *
 * 病根:doubao-seedream i2i 模式输出跟随参考图尺寸、忽略 size 参数 ——
 * 9:16 项目带横屏参考图(styleBible/角色图)时分镜图出 2848x1600 横屏,
 * 面板显示横图、i2v 首帧横屏、成片 letterbox 上下黑边。
 * 守门:产出后 ffprobe 校验宽高比,漂移超容差 → ffmpeg 中央 cover 裁切到目标
 * 尺寸落持久目录。ffprobe/ffmpeg 缺失或任一步失败 → 原 URL 诚实返回(不阻塞)。
 */
import { execFile } from 'child_process';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { promisify } from 'util';
import path from 'path';
import { persistentMediaDir } from './media-persist';
import { resolveFFmpegPath, resolveFFprobePath } from './ffmpeg-bin';

const execFileAsync = promisify(execFile);

/** 宽高比字符串 → 数值;不识别 → null。 */
export function aspectToRatio(aspect: string | null | undefined): number | null {
  const m = (aspect || '').match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/** 实际宽高与目标画幅比的相对偏差是否超容差(默认 15%)。 */
export function aspectDrifted(width: number, height: number, targetAspect: string, tolerance = 0.15): boolean {
  const target = aspectToRatio(targetAspect);
  if (!target || width <= 0 || height <= 0) return false;
  const actual = width / height;
  return Math.abs(actual - target) / target > tolerance;
}

/** ffprobe 读远端/本地图片宽高;失败 → null。 */
async function probeImageSize(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync(resolveFFprobePath(), [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', url,
    ], { timeout: 20_000 });
    const m = stdout.trim().match(/^(\d+)x(\d+)/);
    return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
  } catch { return null; }
}

/** 目标画幅 → 守门输出尺寸(与 seedream size 表一致)。 */
function targetDims(aspect: string): { w: number; h: number } {
  if (aspect === '9:16') return { w: 720, h: 1280 };
  if (aspect === '1:1') return { w: 1024, h: 1024 };
  return { w: 1280, h: 720 };
}

/**
 * 画幅守门主入口:图片画幅与目标一致 → 原 URL;漂移 → 中央 cover 裁切到目标尺寸,
 * 返回 /api/serve-file 持久 URL。任何失败 → 原 URL(诚实降级,只 warn 不抛)。
 */
export async function ensureImageAspect(url: string, targetAspect: string, label = 'image'): Promise<string> {
  if (!url || !targetAspect || !/^(https?:|\/api\/serve-file)/.test(url)) return url;
  try {
    // serve-file URL 还原本地路径给 ffprobe/ffmpeg 直读
    const local = url.startsWith('/api/serve-file')
      ? decodeURIComponent(new URLSearchParams(url.split('?')[1]).get('path') || '')
      : url;
    const dims = await probeImageSize(local || url);
    if (!dims || !aspectDrifted(dims.width, dims.height, targetAspect)) return url;

    const { w, h } = targetDims(targetAspect);
    const outPath = path.join(persistentMediaDir('images'), `aspectfix-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.png`);
    // scale 到覆盖目标(增,不减)再中央裁切 —— 标准 cover 语义
    await execFileAsync(resolveFFmpegPath(), [
      '-y', '-i', local || url,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
      '-frames:v', '1', outPath,
    ], { timeout: 60_000 });
    console.log(`[AspectGuard] ${label}: ${dims.width}x${dims.height} → ${w}x${h}(画幅漂移,已中央裁切)`);
    return `${serveFilePathUrl(outPath)}`;
  } catch (e) {
    console.warn(`[AspectGuard] ${label} 守门失败,原图透传:`, e instanceof Error ? e.message.slice(0, 60) : e);
    return url;
  }
}
