/**
 * lib/image-signature (v12.368) —— 不依赖任何 API 的图像签名。
 *
 * 背景:v12.350 把画风漂移检测接了线,但端点需要 `IMAGE_EMBED_MODEL`。
 * owner 没配,于是面板永远显示「暂不可用」——**接了线,却看不到一个数字**。
 * 那一版我把这条如实写进了版本日志,这一版把它补上。
 *
 * 做法:用**已在依赖里的 ffmpeg** 把图缩到 8×8 取原始 RGB(192 维),
 * 作为色彩/构图签名喂给既有的 `detectDriftOutliers` —— 那个函数只要 `number[]`,
 * 数学是通用的,不在乎向量来自神经网络还是像素。
 *
 * **能力边界要说清楚,别让人以为它等价于语义 embedding**:
 * · 抓得到:调色跑偏、明暗断层、构图重心突变、某镜整体偏色
 * · 抓不到:同样色调下**人物的脸变了**、服饰细节不一致 —— 那需要语义模型
 * 所以它是 `IMAGE_EMBED_MODEL` 的**降级替代**,不是等价物;配了模型仍优先用模型。
 */
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

/** 缩略边长。8×8×3 = 192 维 —— 够表达色彩分布与大块构图,又不至于被噪点主导。 */
export const SIGNATURE_SIDE = 8;
export const SIGNATURE_DIM = SIGNATURE_SIDE * SIGNATURE_SIDE * 3;

/**
 * 读一张本地图片 → 归一化的 192 维签名。
 *
 * 失败(文件不存在 / 非图片 / ffmpeg 缺失)返回 null —— **不抛**,
 * 调用方按「这一镜没签名」处理即可,不该让整次检测失败。
 */
export function imageSignature(absPath: string): Promise<number[] | null> {
  return new Promise((resolve) => {
    const bin = (ffmpegPath as unknown as string) || 'ffmpeg';
    if (!absPath) return resolve(null);
    const p = spawn(bin, [
      '-v', 'error',
      '-i', absPath,
      '-vf', `scale=${SIGNATURE_SIDE}:${SIGNATURE_SIDE}:flags=area`,
      '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ]);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (c) => chunks.push(c as Buffer));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length < SIGNATURE_DIM) return resolve(null);
      // 归一到 0..1;余弦距离对尺度不敏感,但归一后更便于阈值调试
      resolve(Array.from(buf.subarray(0, SIGNATURE_DIM), (v) => v / 255));
    });
  });
}

/** 批量:保持与输入同序,失败位置为 null。并发 2 路 —— ffmpeg 是进程级开销。 */
export async function imageSignatures(paths: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = new Array(paths.length).fill(null);
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= paths.length) return;
      out[idx] = await imageSignature(paths[idx]);
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}
