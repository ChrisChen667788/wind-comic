/**
 * lib/frame-strip — **逐帧检视**的时间戳规划(纯函数,零依赖)。v12.328。
 *
 * ── 这一版补的是哪条链 ────────────────────────────────────────────
 * v12.315 的片段重拍需要用户给出 `fromS` / `toS`。但界面上没有任何东西让他**看清
 * 坏在哪一帧** —— 只能凭记忆估个秒数。逐帧检视就是补这一段:
 *   翻帧找到坏的那两秒 → 把**那两帧的时间戳**直接交给重拍。
 *
 * ── 为什么必须复用 `snapToFrame` ──────────────────────────────────
 * 这里产出的时间戳会**原样**成为重拍的切点。若本文件自己写一份
 * `Math.round(sec*fps)/fps`,两处迟早在边界上差一帧:用户点了第 47 帧,
 * 却从 46 帧半切下去 —— 而这种错**看不出来**,只体现为成片抖了一下。
 * 所以从 `segment-retake` 导入,不另起一套(本仓在转场、音色、称谓词表、
 * 相对时间、fetchWithTimeout 上已栽过五次)。
 *
 * ── 抽帧本身的精度坑(在服务层,记在这里免得后人重蹈)────────────
 * `scene-split.extractFrameAt` 用的是 `seekInput()`,即 `-ss` 放在 `-i` **之前** ——
 * 快,但只能定位到**关键帧**。做拉片中帧够用;逐帧检视绝对不行:用户看到的画面
 * 与标注的时间戳不是同一帧,他据此选的重拍区间就是错的。
 * 本能力的抽帧必须把 `-ss` 放在 `-i` **之后**(精确 seek),与 v12.315
 * `cutSegment` 的做法一致。
 */
import { snapToFrame } from './segment-retake';

export interface FrameStripInput {
  /** 该镜成片时长(秒)—— 取自 timeline 终值,不是剧本设计值 */
  shotDurationS: number;
  /** 检视窗口起点(秒);缺省 0 */
  fromS?: number;
  /** 检视窗口终点(秒);缺省整镜 */
  toS?: number;
  fps?: number;
  /** 最多取多少帧(护栏:整镜逐帧可能上百张) */
  maxFrames?: number;
}

export interface FrameStripPlan {
  ok: boolean;
  reason?: string;
  fps: number;
  /** 每帧的**精确**时间戳(秒),已帧吸附;可直接作为重拍切点 */
  timestamps: number[];
  /** 帧序号(相对整镜起点),给界面显示「第 N 帧」 */
  frameIndexes: number[];
  /** 实际步长:1 = 逐帧;>1 = 因超过 maxFrames 而抽稀 */
  step: number;
  /** 是否被抽稀(界面要明说,否则用户以为看的是每一帧)*/
  thinned: boolean;
}

const DEFAULT_FPS = 24;
const DEFAULT_MAX_FRAMES = 120;

export function planFrameStrip(input: FrameStripInput): FrameStripPlan {
  const fps = Number.isFinite(input.fps) && (input.fps as number) > 0 ? (input.fps as number) : DEFAULT_FPS;
  const fail = (reason: string): FrameStripPlan =>
    ({ ok: false, reason, fps, timestamps: [], frameIndexes: [], step: 1, thinned: false });

  const D = Number(input.shotDurationS);
  if (!Number.isFinite(D) || D <= 0) return fail('该镜还没有成片时长 —— 先出一次片再来逐帧看');

  const maxFrames = Number.isFinite(input.maxFrames) && (input.maxFrames as number) > 0
    ? Math.floor(input.maxFrames as number) : DEFAULT_MAX_FRAMES;

  let a = snapToFrame(Math.max(0, Number(input.fromS ?? 0)), fps);
  let b = snapToFrame(Math.min(D, Number(input.toS ?? D)), fps);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fail('检视区间不是有效数字');
  if (b <= a) return fail('检视区间为空(终点不大于起点)');

  // 区间内的帧序号(相对整镜起点),含首尾
  const first = Math.round(a * fps);
  const last = Math.min(Math.round(b * fps), Math.round(D * fps) - 1);
  if (last < first) return fail('检视区间不足一帧');

  const total = last - first + 1;
  // 超出上限就等间隔抽稀 —— 但要如实告诉界面「这不是每一帧」
  const step = total > maxFrames ? Math.ceil(total / maxFrames) : 1;

  const frameIndexes: number[] = [];
  for (let f = first; f <= last; f += step) frameIndexes.push(f);
  // 抽稀时保证末帧在列(用户常要选到区间末尾)
  if (step > 1 && frameIndexes[frameIndexes.length - 1] !== last) frameIndexes.push(last);

  return {
    ok: true,
    fps,
    frameIndexes,
    timestamps: frameIndexes.map((f) => snapToFrame(f / fps, fps)),
    step,
    thinned: step > 1,
  };
}

/**
 * 由用户选中的两帧得出重拍区间。
 *
 * 刻意**不**做时长校验 —— 那是 `planSegmentRetake` 的职责(引擎下限、总时长不变
 * 都在那边)。这里只负责一件事:把「第 i 帧到第 j 帧」翻译成**同一套吸附口径**下的
 * 秒区间,且 `toS` 取 j+1 帧的起点(选中第 j 帧意味着**包含**它)。
 */
export function frameRangeToSeconds(
  fromFrame: number, toFrame: number, fps: number,
): { fromS: number; toS: number } {
  const f = Math.max(0, Math.min(fromFrame, toFrame));
  const t = Math.max(fromFrame, toFrame);
  return {
    fromS: snapToFrame(f / fps, fps),
    toS: snapToFrame((t + 1) / fps, fps),   // 含末帧
  };
}
