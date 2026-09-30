/**
 * services/segment-retake-run — 片段重拍**端到端**执行:生成补丁 → 缝合 → 校验 → 落盘 → 记 take。v12.459。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────────
 * v12.315 起路由的非 dryRun 分支要求调用方自带 `patchUrl`,拿到后**原样记成 take** —— 从不缝合;
 * 采用时整镜(如 8s)被换成那段裸补丁(如 3s),正是 v12.314 要守的「时长不变」不变量。
 * 缝合层(services/segment-retake.service.ts)在 v12.456 修好了,但全仓零调用(TODO-CARRYOVERS C 条)。
 * 这里把整条链接起来,路由只剩鉴权、预算和并发互斥。
 *
 * 生成补丁的函数由调用方注入(`generatePatch`):线上走编排器的单镜重生,测试注入本地 ffmpeg 造的补丁 ——
 * 于是整条链(取原片、截首帧、缝合、时长校验、落盘、记 take)能在不花钱的前提下真跑。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { planSegmentRetake, type SegmentRetakePlan } from '@/lib/segment-retake';
import { normalizeProjectFormat } from '@/lib/project-format';
import { resolveLocalMediaPath } from '@/lib/media-local-path';
import { persistentMediaDir } from '@/lib/media-persist';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { recordSegmentTake } from '@/lib/shot-segment-retake';
import { isPlaceholderVideo } from '@/lib/placeholder-provenance';
import { planAndExecute } from './segment-retake.service';

const execFileP = promisify(execFile);

const parseJson = (raw: string | null | undefined): any => {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

/** 缝合产物与首帧的持久子目录(data/media/seg-retakes —— 在 serve-file 白名单内) */
export const SEG_RETAKE_MEDIA_KIND = 'seg-retakes';

/** 取该镜**成片终值**时长 —— 必须读 timeline(v12.298 起那里才是终值),不能读 script 设计值 */
export async function shotFinalDuration(projectId: string, shotNumber: number): Promise<number> {
  const rows = await listAssetsByType(projectId, 'timeline');
  const tl = parseJson(rows[0]?.data) || {};
  const t = (Array.isArray(tl.timeline) ? tl.timeline : []).find((x: any) => x?.shotNumber === shotNumber);
  return Number(t?.duration) || 0;
}

/** 项目帧率(与 export-edl 同一口径:project-format 资产,缺省 24) */
export async function projectFps(projectId: string): Promise<number> {
  const rows = await listAssetsByType(projectId, 'project-format');
  return normalizeProjectFormat(parseJson(rows[0]?.data) || {}).fps;
}

/** 该镜活动版视频的地址(与重新合成同一口径:persistent_url 优先)及它是不是占位片 */
export async function activeShotVideo(projectId: string, shotNumber: number): Promise<{ url: string; isAnimatic: boolean }> {
  const rows = await listAssetsByType(projectId, 'video');
  const row = rows.find((r) => r.shot_number === shotNumber);
  if (!row) return { url: '', isAnimatic: false };
  return {
    url: row.persistent_url || (parseJson(row.media_urls) || [])[0] || '',
    // 统一判据(v12.430):显式标记之外,还要认 qf-animatic- 路径 —— 库里有不带标记的占位片
    isAnimatic: isPlaceholderVideo(row),
  };
}

/** 远端下载上限:一镜视频远小于它;不设就沿用 remote-media 的 2GB 兜底 */
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

/** 补丁生成函数:线上 = 编排器单镜重生;测试 = 本地造的补丁 */
export type GeneratePatch = (args: {
  shotNumber: number;
  durationS: number;
  /** 原片在切入点的那一帧(站内 serve-file 地址)—— 让补丁从原画面接着拍 */
  firstFrameUrl: string | null;
  /** 用户对这一段的修改说明(可选) */
  promptExtra?: string;
}) => Promise<{ videoUrl: string; isAnimatic: boolean }>;

export class SegmentRetakeError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: Record<string, unknown>) {
    super(message);
  }
}

export interface RunSegmentRetakeResult {
  takeId: string;
  videoUrl: string;
  plan: SegmentRetakePlan;
  measuredDurationS: number;
  patchIsAnimatic: boolean;
}

/** 在指定时刻截一帧(ffmpeg `-ss` 放在 `-i` 之后 = 解码后精确定位,与缝合的 trim 同一口径) */
async function extractFrameAt(ffmpegBin: string, src: string, atS: number, out: string): Promise<void> {
  await execFileP(ffmpegBin, [
    '-v', 'error', '-y', '-i', src, '-ss', atS.toFixed(6), '-frames:v', '1', '-q:v', '2', out,
  ]);
}

/** 视频轨真实解码帧数(容器时长会被音轨撑长,不能拿来验画面) */
async function countVideoFrames(ffprobeBin: string, file: string): Promise<number> {
  const { stdout } = await execFileP(ffprobeBin, [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ]);
  return Number(String(stdout).trim().split(/[\s,]+/)[0]) || 0;
}

/** 视频轨时长(秒):优先流时长,取不到再用容器时长 */
async function videoStreamDuration(ffprobeBin: string, file: string): Promise<number> {
  const { stdout } = await execFileP(ffprobeBin, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=duration:format=duration', '-of', 'json', file,
  ]);
  const j = JSON.parse(String(stdout) || '{}');
  const s = Number(j?.streams?.[0]?.duration);
  return Number.isFinite(s) && s > 0 ? s : Number(j?.format?.duration) || 0;
}

export async function runSegmentRetake(
  input: { projectId: string; shotNumber: number; fromS: number; toS: number; prompt?: string },
  deps: { generatePatch: GeneratePatch; allowAnimaticPatch?: boolean },
): Promise<RunSegmentRetakeResult> {
  const { projectId, shotNumber, fromS, toS } = input;

  const shotDurationS = await shotFinalDuration(projectId, shotNumber);
  if (!shotDurationS) {
    throw new SegmentRetakeError(`镜 ${shotNumber} 还没有成片时长(先出一次片再来重拍片段)`, 409);
  }
  const fps = await projectFps(projectId);
  const plan = planSegmentRetake({ shotDurationS, fromS, toS, fps });
  if (!plan.ok) throw new SegmentRetakeError(plan.reason || '片段重拍计划无效', 400, { plan });

  const { url: sourceUrl, isAnimatic: sourceIsAnimatic } = await activeShotVideo(projectId, shotNumber);
  if (!sourceUrl) throw new SegmentRetakeError(`镜 ${shotNumber} 还没有视频活动版(先出一次片)`, 409);

  const temps: string[] = [];
  const tempDirs: string[] = [];
  let firstFramePath: string | null = null;
  try {
    const source = await resolveLocalMediaPath(sourceUrl, { allowRemote: true, ext: '.mp4', maxBytes: MAX_DOWNLOAD_BYTES });
    if (!source) throw new SegmentRetakeError(`读不到镜 ${shotNumber} 的原片文件(地址既不是站内文件也不是可下载的远端地址)`, 409);
    if (source.tempFile) temps.push(source.tempFile);

    // 原片在切入点的那一帧 → 补丁首帧。plan.trimFromS 恒为 0:补丁的第 0 秒正好落在 patchFromS,
    // 用这一帧起拍,接缝处画面才连得上。截不出来不致命(引擎退回用分镜图),但要留痕。
    const { resolveFFmpegPath } = await import('./video-composer');
    const mediaDir = persistentMediaDir(SEG_RETAKE_MEDIA_KIND);
    const stamp = `${shotNumber}-${Date.now()}`;
    try {
      firstFramePath = path.join(mediaDir, `segtake-frame-${projectId}-${stamp}.jpg`);
      await extractFrameAt(resolveFFmpegPath(), source.path, plan.patchFromS, firstFramePath);
    } catch (e) {
      console.warn(`[segment-retake] 截首帧失败,补丁将不带原片首帧:${e instanceof Error ? e.message.slice(0, 120) : e}`);
      firstFramePath = null;
    }

    const patch = await deps.generatePatch({
      shotNumber,
      durationS: plan.generateDurationS,
      firstFrameUrl: firstFramePath ? serveFilePathUrl(firstFramePath) : null,
      promptExtra: input.prompt?.trim() || undefined,
    });
    if (patch.isAnimatic && !deps.allowAnimaticPatch) {
      // 引擎全挂时编排器会回落成静止图缓推的占位片 —— 缝进真镜头只会更糟,还会伪装成「重拍成功」
      throw new SegmentRetakeError('视频引擎没有出片(回落成了静止图占位片),这次不记 take。请检查引擎余额或稍后再试', 502);
    }
    const patchFile = await resolveLocalMediaPath(patch.videoUrl, { allowRemote: true, ext: '.mp4', maxBytes: MAX_DOWNLOAD_BYTES });
    if (!patchFile) throw new SegmentRetakeError('补丁素材地址无法读取', 502, { patchUrl: String(patch.videoUrl).slice(0, 120) });
    if (patchFile.tempFile) temps.push(patchFile.tempFile);

    // 补丁画面必须覆盖计划要用的那一段。**必须在缝合前验**:缝合末尾的 fps 滤镜会用上一帧填满空档,
    // 输出照样是整镜帧数、容器时长也对 —— 只是画面冻住一截,从产物上根本看不出来(本版测试当场抓到)。
    const { resolveFFprobePath } = await import('./video-composer');
    const patchVideoS = await videoStreamDuration(resolveFFprobePath(), patchFile.path);
    if (patchVideoS + 1 / fps < plan.trimToS) {
      throw new SegmentRetakeError(
        `引擎给的补丁画面只有 ${patchVideoS.toFixed(2)}s,这一段至少需要 ${plan.trimToS.toFixed(2)}s,没有记下这次重拍`,
        422,
        { patchVideoS, neededS: plan.trimToS },
      );
    }

    const stitched = await planAndExecute({
      shotDurationS, fromS, toS, fps,
      sourcePath: source.path, patchPath: patchFile.path,
    });
    // 不传 outputDir → 服务在 os.tmpdir() 自建目录且成功后不自删(v12.313 约定),收尾归这里
    tempDirs.push(path.dirname(stitched.outputPath));

    // 时长不变量:差一帧以上就不记 —— 记下去,采用时就会把时间轴、配音、字幕一起带歪。
    // **两道都要验**:容器时长取各轨最长的那条 —— 补丁画面比要的短时,音轨照样按计划补满静音,
    // 容器时长仍是整镜长度,画面却少了一截(本版测试用一段 1s 的补丁当场抓到)。所以另数视频轨真实帧数。
    const frame = 1 / fps;
    const gotFrames = await countVideoFrames(resolveFFprobePath(), stitched.outputPath);
    const wantFrames = Math.round(stitched.plan.totalAfterS * fps);
    if (Math.abs(gotFrames - wantFrames) > 1) {
      throw new SegmentRetakeError(
        `缝合后画面 ${gotFrames} 帧,该镜应为 ${wantFrames} 帧(${fps}fps)—— 补丁素材${gotFrames < wantFrames ? '比需要的短' : '比需要的长'},差了一帧以上,没有记下这次重拍`,
        422,
        { videoFrames: gotFrames, expectedFrames: wantFrames },
      );
    }
    if (Math.abs(stitched.measuredDurationS - stitched.plan.totalAfterS) > frame + 1e-6) {
      throw new SegmentRetakeError(
        `缝合后时长 ${stitched.measuredDurationS.toFixed(3)}s 与该镜 ${stitched.plan.totalAfterS.toFixed(3)}s 差了一帧以上(帧长 ${frame.toFixed(4)}s),没有记下这次重拍`,
        422,
        { measuredDurationS: stitched.measuredDurationS, totalAfterS: stitched.plan.totalAfterS },
      );
    }

    const outPath = path.join(mediaDir, `segtake-${projectId}-${stamp}.mp4`);
    await fs.promises.copyFile(stitched.outputPath, outPath);
    // 刻意写成「落盘结果对象」:persistent_url 门禁(v12.347)要求赋值一眼看得出是落盘产物、不是外链
    const persisted = { url: serveFilePathUrl(outPath) };

    const { takeId } = await recordSegmentTake({
      projectId, shotNumber,
      fromS: stitched.plan.patchFromS, toS: stitched.plan.patchToS,
      videoUrl: persisted.url, persistentUrl: persisted.url,
      prompt: input.prompt?.trim() || undefined,
      planSummary: stitched.plan,
      extra: {
        measuredDurationS: stitched.measuredDurationS,
        patchIsAnimatic: patch.isAnimatic,
        // 这一版画面里还有没有占位成分:补丁是占位,或原片是占位且只换了其中一段(其余仍是静止图缓推)
        resultIsAnimatic: patch.isAnimatic || (sourceIsAnimatic && !!(stitched.plan.head || stitched.plan.tail)),
        // 溯源:补丁原始地址(引擎外链会过期,只作记录)、缝合自哪一版
        patchSourceUrl: String(patch.videoUrl).slice(0, 500),
        stitchedFrom: sourceUrl,
      },
    });
    return { takeId, videoUrl: persisted.url, plan: stitched.plan, measuredDurationS: stitched.measuredDurationS, patchIsAnimatic: patch.isAnimatic };
  } finally {
    for (const f of temps) { try { fs.unlinkSync(f); } catch { /* 删不掉不阻塞 */ } }
    for (const d of tempDirs) {
      // 只删服务在系统临时目录里自建的那一个,绝不越界
      if (path.resolve(d).startsWith(path.resolve(os.tmpdir()))) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 同上 */ }
      }
    }
    // 首帧只在生成补丁时有用;生成完就删(不被任何行引用,留着会被当孤儿清理,不如现在删)
    if (firstFramePath) { try { fs.unlinkSync(firstFramePath); } catch { /* 同上 */ } }
  }
}

/** 进程内同镜互斥:同一镜同时两次重拍会各花一次钱、各留一条 take —— 后到的直接 409 */
const running = new Set<string>();
export function tryLockShot(projectId: string, shotNumber: number): (() => void) | null {
  const k = `${projectId}#${shotNumber}`;
  if (running.has(k)) return null;
  running.add(k);
  return () => { running.delete(k); };
}
