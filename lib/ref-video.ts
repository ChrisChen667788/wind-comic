/**
 * lib/ref-video — 参考视频(动作迁移)的规则层。v12.448。纯函数 + 只读文件,不碰数据库。
 *
 * MiniMax H3 的 `content[]` 可以带 `role: 'reference_video'` 的视频,让出片学它的动作与运镜。
 * 官方契约(2026-09-19 核 platform.minimax.io 的 video-generation-v2-create):
 *   - 每次 ≤3 段;单段 2–15 秒,**所有参考视频合计 ≤15 秒**;单文件 ≤50MB
 *   - MP4 / MOV,H.264 或 H.265;宽高各 256–5760px,宽高比 0.4–2.5;帧率 23.976–60
 *   - 地址可以是公网 URL,也可以是 base64 data URI;整个请求体 ≤64MB(大文件官方建议用 URL)
 *   - **没有**「学动作 / 学运镜」的子角色 —— 只能在提示词里说
 *   - 与首帧(first_frame)互斥:用了参考素材就不能再给首帧
 *
 * 本仓一镜只挂一段(≤15 秒,正好吃满合计上限)。本地上传的文件 MiniMax 访问不到(localhost),
 * 发送时转成 base64 —— 所以本地文件另有一道更紧的**内联上限**,给参考图留出请求体余量。
 */
import fs from 'fs';
import path from 'path';
import { H3_REF_LIMITS } from './minimax-video-api';

export const REF_VIDEO_LIMITS = {
  minSec: 2,
  maxSec: 15,
  /** 官方单文件上限 */
  maxBytes: 50 * 1024 * 1024,
  /** 本地文件转 base64 的上限:20MB → 约 27MB 字符串,给最多 9 张参考图留出 64MB 请求体的余量 */
  maxInlineBytes: 20 * 1024 * 1024,
  minPx: 256,
  maxPx: 5760,
  minRatio: 0.4,
  maxRatio: 2.5,
  minFps: 23.976,
  maxFps: 60,
} as const;

/** 容器/编码白名单(ffprobe 的 format_name / codec_name 口径) */
const OK_CONTAINERS = ['mov', 'mp4', 'm4a', '3gp', 'mj2', 'quicktime'];
const OK_CODECS = ['h264', 'hevc'];

export interface RefVideoProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number | null;
  sizeBytes: number | null;
  /** ffprobe format_name,如 "mov,mp4,m4a,3gp,3g2,mj2" */
  formatName?: string | null;
  /** 视频流 codec_name,如 "h264" */
  codec?: string | null;
}

export interface RefVideoVerdict {
  ok: boolean;
  /** 不通过的原因(中文,直接给用户看) */
  errors: string[];
  /** 超过 15 秒时:截取前 N 秒即可用(不算错误,但要告诉用户) */
  trimTo?: number;
}

/**
 * 校验一段参考视频。**只报能确定的** —— 探测拿不到的维度(fps 为 null 等)不当成错误,
 * 交给引擎最终裁决;宁可让 MiniMax 拒,也别在本地把合法视频误杀。
 */
export function checkRefVideo(p: RefVideoProbe, opts: { inline?: boolean } = {}): RefVideoVerdict {
  const L = REF_VIDEO_LIMITS;
  const errors: string[] = [];
  let trimTo: number | undefined;

  if (!(p.durationSec > 0)) errors.push('读不出视频时长(文件可能损坏或不是视频)');
  else if (p.durationSec < L.minSec) errors.push(`太短了:${p.durationSec.toFixed(1)} 秒,至少 ${L.minSec} 秒`);
  else if (p.durationSec > L.maxSec) trimTo = L.maxSec;

  const w = p.width, h = p.height;
  if (!(w > 0 && h > 0)) errors.push('读不出画面尺寸');
  else {
    if (w < L.minPx || h < L.minPx || w > L.maxPx || h > L.maxPx) errors.push(`画面尺寸 ${w}×${h} 超出 ${L.minPx}–${L.maxPx} 像素范围`);
    const r = w / h;
    if (r < L.minRatio || r > L.maxRatio) errors.push(`宽高比 ${r.toFixed(2)} 超出 ${L.minRatio}–${L.maxRatio}(太窄或太扁)`);
  }
  if (p.fps != null && (p.fps < L.minFps - 0.01 || p.fps > L.maxFps + 0.01)) errors.push(`帧率 ${p.fps} 不在 24–60 之间`);

  const cap = opts.inline ? L.maxInlineBytes : L.maxBytes;
  if (p.sizeBytes != null && p.sizeBytes > cap) {
    errors.push(opts.inline
      ? `文件 ${(p.sizeBytes / 1048576).toFixed(1)}MB,超过本地上传上限 ${cap / 1048576}MB(本地文件要转成 base64 随请求发送)—— 请压缩后再传,或改用公网链接`
      : `文件 ${(p.sizeBytes / 1048576).toFixed(1)}MB,超过官方上限 ${cap / 1048576}MB`);
  }
  if (p.formatName && !p.formatName.split(',').some((f) => OK_CONTAINERS.includes(f.trim()))) {
    errors.push(`容器格式 ${p.formatName} 不支持,只收 MP4 / MOV`);
  }
  if (p.codec && !OK_CODECS.includes(p.codec)) errors.push(`视频编码 ${p.codec} 不支持,只收 H.264 / H.265`);

  return { ok: errors.length === 0, errors, ...(trimTo ? { trimTo } : {}) };
}

const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4' };

export type EngineVideo = { ok: true; url: string } | { ok: false; reason: string };

/**
 * 参考视频 → 引擎能取的形态。
 * - http(s):原样(MiniMax 自己去下)
 * - 站内文件:读盘转 base64 data URI(localhost 地址 MiniMax 访问不到)
 * - 其余 / 读不到 / 超内联上限:**说清楚为什么不能用**,由调用方如实告诉用户
 *
 * 异步读盘(最大 20MB,同步读会卡住整个进程的事件循环);文件在检查与读取之间被清理等任何读盘异常
 * 都转成「用不了 + 原因」,**不抛** —— 增强项不能把出片打挂(两条都是对抗复查挖出)。
 * `resolveLocal` 注入是为了可测:生产里传 lib/first-frame 的 serveFileToLocalPath。
 */
export async function refVideoToEngine(url: string | null | undefined, resolveLocal: (u: string) => string | null): Promise<EngineVideo> {
  const u = (url || '').trim();
  if (!u) return { ok: false, reason: '没有参考视频地址' };
  if (/^https?:\/\//i.test(u)) return { ok: true, url: u };
  if (u.startsWith('data:video/')) return { ok: true, url: u };
  const gone = { ok: false as const, reason: '参考视频文件在本机找不到了(可能被清理),请重新上传' };
  try {
    const local = resolveLocal(u);
    if (!local) return gone;
    // 存在性也用异步 stat 判(第四轮复查:这里曾残留一个 fs.existsSync,与本函数「异步读盘」的承诺相悖)
    let size: number;
    try {
      size = (await fs.promises.stat(local)).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return gone;
      throw e;
    }
    const mime = VIDEO_MIME[path.extname(local).toLowerCase()];
    if (!mime) return { ok: false, reason: `参考视频格式 ${path.extname(local) || '(无扩展名)'} 不支持,只收 MP4 / MOV` };
    if (size > REF_VIDEO_LIMITS.maxInlineBytes) {
      return { ok: false, reason: `本地参考视频 ${(size / 1048576).toFixed(1)}MB 超过 ${REF_VIDEO_LIMITS.maxInlineBytes / 1048576}MB 内联上限,请压缩或改用公网链接` };
    }
    return { ok: true, url: `data:${mime};base64,${(await fs.promises.readFile(local)).toString('base64')}` };
  } catch (e) {
    // 原因会经 agentTalk / status 推给前端 —— 读盘报错里带本机路径,只进服务端日志
    console.warn('[ref-video] 读取本地参考视频失败:', e instanceof Error ? e.message : e);
    return { ok: false, reason: '读取参考视频失败(服务器读盘出错),请重新上传;反复出现请联系部署方' };
  }
}

/**
 * 参考视频没有「学动作 / 学运镜」的字段,只能写进提示词 —— 措辞集中在这一处。
 * 已经带了就不重复(重试 / 回落会让同一段提示词再进来一次)。
 */
export const REF_VIDEO_HINT = 'Follow the body motion and camera movement of the reference video; keep the characters and setting described above.';
export function withRefVideoHint(prompt: string): string {
  const p = (prompt || '').trim();
  if (p.includes(REF_VIDEO_HINT)) return p;
  return p ? `${p}${/[.!?。]$/.test(p) ? '' : '.'} ${REF_VIDEO_HINT}` : REF_VIDEO_HINT;
}

/**
 * 服务层回报「这一镜的参考视频最后怎样了」—— 发出去了,还是被忽略了(以及为什么)。
 * 忽略不是失败:这一镜会去掉参考视频照常出片,但**必须让用户知道**,不然他以为动作是照着参考做的。
 */
export type RefVideoOutcome =
  | { status: 'sent'; engine: 'minimax-h3'; imagesSent: number; imagesDropped: number }
  | { status: 'ignored'; reason: string };

/** 请求体预算(字符数 ≈ 字节数):官方上限 64MB,留 4MB 给 JSON 与文本 */
export const H3_BODY_BUDGET = 60 * 1024 * 1024;

/**
 * 参考模式下挑哪些图发给 H3。**参考模式不能带首帧**(官方互斥),所以分镜图降级为第一张参考图来保构图。
 * 优先级:分镜图 → 每个角色正面 → 角度图按轮次(每个角色轮流拿一张,不让第一个角色独占名额)→ 场景/风格参考。
 * 去重(按原始地址)、转引擎可取形态(转不了的计入 dropped,不静默)、9 张封顶、请求体预算封顶。
 */
export function planH3RefImages(input: {
  frame?: string | null;
  subjects?: Array<{ imageUrl?: string; refImageUrls?: string[] }>;
  extras?: string[];
  videoUrl: string;
}, toEngine: (u: string) => string | null): { images: string[]; dropped: number } {
  const subjects = input.subjects || [];
  const want: string[] = [];
  if (input.frame) want.push(input.frame);
  for (const s of subjects) if (s?.imageUrl) want.push(s.imageUrl);
  const rounds = Math.max(0, ...subjects.map((s) => s?.refImageUrls?.length || 0));
  for (let i = 0; i < rounds; i++) for (const s of subjects) { const u = s?.refImageUrls?.[i]; if (u) want.push(u); }
  for (const u of input.extras || []) if (u) want.push(u);

  const seen = new Set<string>();
  const images: string[] = [];
  let bytes = (input.videoUrl || '').length;
  let dropped = 0;
  for (const raw of want) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const u = toEngine(raw);
    if (!u) { dropped++; continue; }
    if (images.length >= H3_REF_LIMITS.images || bytes + u.length > H3_BODY_BUDGET) { dropped++; continue; }
    images.push(u);
    bytes += u.length;
  }
  return { images, dropped };
}
