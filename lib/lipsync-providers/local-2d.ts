/**
 * lib/lipsync-providers/local-2d (v10.1.0) — 本地零配置 2D 口型引擎(ffmpeg overlay)。
 *
 * 目的:让整条配音口型链(规划→预览→评分→门禁→渲染→写回→质检→成本)**开箱即用**,
 * 不必自托管 wav2lip/SadTalker(那需 LIPSYNC_API_URL)。本引擎用 viseme 轨驱动 8 张
 * 口型贴图(public/lipsync/mouths/*.png),在说话人脸(或纯色底)下方的「口型条」里按
 * 时间窗口切换,muxin 配音音频 → 产出对口型的示意成片(v10.4.4 起经 storage adapter 落盘返 URL)。
 *
 * 不是照片级对口型(嘴未贴到脸上的真实位置),而是**零配置的 2D 示意口型**;真引擎一旦
 * 配置(wav2lip-http,priority 50)会优先于本引擎(priority 100)。
 *
 * 依赖:ffmpeg-static(随包,生产无需 PATH 有 ffmpeg)。env `LIPSYNC_LOCAL_DISABLE=1` 可关。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegStatic from 'ffmpeg-static';
import { registerLipSyncProvider } from './registry';
import type { LipSyncProvider, LipSyncGenerateInput, LipSyncGenerateResult } from './types';
import { buildVisemeSegments, enableExpr, segmentsDuration, VISEME_IDS } from '../lipsync-segments';

const execFileP = promisify(execFile);
const MOUTH_DIR = path.join(process.cwd(), 'public', 'lipsync', 'mouths');
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// v10.4.0: 导出给 /api/mock-assets 复用(mock 视频也走同一套 ffmpeg 解析链)
export function ffmpegBin(): string | null {
  // 顺序:env 显式覆盖 → ffmpeg-static(随包二进制)→ 常见系统路径。
  // (Next 打包有时会让 ffmpeg-static 的 __dirname 失效 → 路径不存在,故补系统兜底。)
  const candidates = [
    process.env.LIPSYNC_FFMPEG_PATH,
    (ffmpegStatic as unknown as string) || '',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}
function mouthsReady(): boolean {
  try {
    return VISEME_IDS.every((v) => fs.existsSync(path.join(MOUTH_DIR, `${v}.png`)));
  } catch {
    return false;
  }
}
function extFromCt(ct: string): string {
  const b = (ct || '').split(';')[0].trim().toLowerCase();
  const m: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
    'audio/aac': '.aac', 'audio/mp4': '.m4a', 'audio/webm': '.webm', 'video/mp4': '.mp4',
  };
  return m[b] || '';
}

/** 把 data:/http(s) 资源落到临时文件;返回扩展名。相对/未知 → null。 */
async function fetchToFile(url: string, stem: string): Promise<{ ext: string; file: string } | null> {
  try {
    if (!url) return null;
    if (url.startsWith('data:')) {
      const i = url.indexOf(',');
      if (i < 0) return null;
      const meta = url.slice(5, i);
      const isB64 = /;base64/i.test(meta);
      const data = url.slice(i + 1);
      const buf = isB64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
      const ext = extFromCt(meta.split(';')[0]) || '.bin';
      const file = stem + ext;
      fs.writeFileSync(file, buf);
      return { ext, file };
    }
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ext = extFromCt(res.headers.get('content-type') || '') || path.extname(new URL(url).pathname) || '.bin';
      const file = stem + ext;
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return { ext, file };
    }
    return null;
  } catch {
    return null;
  }
}

async function generate(input: LipSyncGenerateInput): Promise<LipSyncGenerateResult> {
  const bin = ffmpegBin();
  if (!bin) throw new Error('ffmpeg 不可用(ffmpeg-static 未解析)');
  if (!mouthsReady()) throw new Error('口型贴图缺失:public/lipsync/mouths/*.png');
  if (!input.audioUrl) throw new Error('缺配音音频');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lipsync-'));
  try {
    // 说话人脸:仅栅格图可作底(SVG/失败 → 纯色底,口型条照常动)
    const faceRes = await fetchToFile(input.faceUrl || '', path.join(dir, 'face'));
    const facePath = faceRes && RASTER.has(faceRes.ext.toLowerCase()) ? faceRes.file : null;

    // 配音音频:必须
    const audioRes = await fetchToFile(input.audioUrl, path.join(dir, 'audio'));
    if (!audioRes) throw new Error('音频无法获取(仅支持 data:/http(s))');

    // viseme 分段 + 时长
    const segs = buildVisemeSegments(input.visemes || [], undefined);
    let dur = segmentsDuration(segs);
    if (!dur || dur < 0.3) dur = 2;
    dur = Math.min(dur, 60); // 安全上限

    // 滤镜图:底(脸/纯色)→ 底部口型条 → 8 个口型按 enable 窗口叠加
    const W = 720;
    const BAR = 140;
    const chains: string[] = [];
    chains.push(`[0:v]scale=${W}:-2,setsar=1,format=rgba[bg]`);
    chains.push(`[bg]drawbox=x=0:y=ih-${BAR}:w=iw:h=${BAR}:color=black@0.42:t=fill[bar]`);
    VISEME_IDS.forEach((v, i) => chains.push(`[${i + 1}:v]scale=-1:104[m${v}]`));
    let cur = 'bar';
    VISEME_IDS.forEach((v, i) => {
      const out = i === VISEME_IDS.length - 1 ? 'vout' : `ov${i}`;
      chains.push(`[${cur}][m${v}]overlay=x=(W-w)/2:y=H-${BAR}+(${BAR}-h)/2:enable='${enableExpr(segs, v)}'[${out}]`);
      cur = out;
    });
    const graph = chains.join(';');

    // 输入:0=底(脸图 loop / lavfi 纯色),1..8=口型(loop),9=音频
    const inputs: string[] = [];
    if (facePath) inputs.push('-loop', '1', '-i', facePath);
    else inputs.push('-f', 'lavfi', '-i', `color=c=0x0d1018:s=${W}x${W}:d=${dur.toFixed(2)}`);
    for (const v of VISEME_IDS) inputs.push('-loop', '1', '-i', path.join(MOUTH_DIR, `${v}.png`));
    inputs.push('-i', audioRes.file);

    const outPath = path.join(dir, 'out.mp4');
    const args = [
      '-y', ...inputs,
      '-filter_complex', graph,
      '-map', '[vout]', '-map', '9:a',
      '-t', dur.toFixed(2), '-r', '25',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '24',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-shortest',
      outPath,
    ];
    input.onProgress?.(15, '合成 2D 口型示意片…');
    await execFileP(bin, args, { timeout: 120_000, maxBuffer: 1 << 24 });
    input.onProgress?.(90, '编码完成');

    const mp4 = fs.readFileSync(outPath);
    if (!mp4.length) throw new Error('ffmpeg 产出空文件');
    input.onProgress?.(100, '完成');
    // v10.4.4: 改走 storage adapter 落盘返 URL —— 此前直接吐 data:video/mp4
    // (多 MB base64 走内存/JSON 边界,且 data: 会被多处下游过滤);
    // 现在 local 返 /api/serve-file?key=,配 S3 时自动上对象存储。
    const { storagePut } = await import('../storage');
    const put = await storagePut(mp4, 'video/mp4', '.mp4');
    return {
      videoUrl: put.url,
      provider: 'local-2d',
      durationSec: dur,
      estCostCny: 0, // 本地渲染零外部成本
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const localProvider: LipSyncProvider = {
  id: 'local-2d',
  name: '本地 2D 口型示意(零配置 · ffmpeg)',
  priority: 100, // 低于 wav2lip-http(50):真引擎配置后优先,本地作零配置兜底
  supportsVideoDriver: false,
  available: () => !process.env.LIPSYNC_LOCAL_DISABLE && !!ffmpegBin() && mouthsReady(),
  generate,
};

registerLipSyncProvider(localProvider);
