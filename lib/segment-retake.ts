/**
 * lib/segment-retake — 镜内片段重拍的**缝合计划**(纯函数,零依赖)。
 *
 * v12.314。此前只能重生**整镜**:8 秒里错 2 秒也要整镜重抽,**四倍的浪费**。
 * 竞品(LibTV 片段重拍)把它做成了「选中时间段 → 只重生这段 → 替换回整片」。
 *
 * ── 竞品宣传里回避掉的两个硬问题,这里必须正面处理 ────────────────────
 *
 * **① 引擎有最短时长,想生成 2 秒是生成不出来的。**
 * HappyHorse 是 3–15s(v12.295 查证过官方文档),多数引擎也有下限。
 * 所以「重拍 2 秒」的真实做法是:**按引擎下限生成(如 3s),再裁出需要的 2s**。
 * 计划里因此分开两个量:`generateDurationS`(要向引擎请求多长)与
 * `trimFromS/trimToS`(生成物里取哪一段)。把这两个混为一谈,要么请求被引擎拒,
 * 要么补进去的片段比缺口长,整条时间轴顺移。
 *
 * **② 缝回后总时长必须一字不差地不变。**
 * 一旦变了,下游全线错位:xfade 压缩时间轴、配音 adelay、字幕起点、EDL record-in ——
 * 这些在 v12.264/265/297 都刚以「单一真源」的方式对齐过,不能被重拍破坏。
 * 所以 `totalAfterS === shotDurationS` 是本模块的**核心不变量**,测试里直接锁它。
 *
 * **③ 帧对齐。** 在非帧边界裁切会产生亚帧漂移,累积起来就是 v12.277 那类精度病。
 * 所有切点先吸附到帧栅格,再算时长。
 */

export interface SegmentRetakePlanInput {
  /** 该镜在成片里的时长(秒)——**终值**,不是设计值 */
  shotDurationS: number;
  /** 要重拍的片段起点(秒,相对该镜开头) */
  fromS: number;
  /** 要重拍的片段终点(秒) */
  toS: number;
  /** 项目帧率;切点按它吸附 */
  fps?: number;
  /** 引擎能接受的最短生成时长(秒)。不传按 3s——目前已知引擎里最宽松的下限 */
  engineMinDurationS?: number;
  /** 引擎能接受的最长生成时长(秒) */
  engineMaxDurationS?: number;
}

export interface SegmentRetakePlan {
  ok: boolean;
  /** ok=false 时说明原因(给用户看的人话) */
  reason?: string;
  /** 保留的前段;整段从头重拍时为 null */
  head: { fromS: number; toS: number } | null;
  /** 保留的后段;整段拍到尾时为 null */
  tail: { fromS: number; toS: number } | null;
  /** 补丁段落在成片里的位置(帧对齐后) */
  patchFromS: number;
  patchToS: number;
  /** **要向引擎请求的时长** —— 可能大于 patch 长度(引擎下限所致) */
  generateDurationS: number;
  /** 从生成物里裁出补丁的区间 */
  trimFromS: number;
  trimToS: number;
  /** 缝合后总时长;必须 === shotDurationS */
  totalAfterS: number;
  /** 为满足引擎下限而多生成的秒数(0 表示正好) */
  padSeconds: number;
}

const snap = (sec: number, fps: number) => Math.round(sec * fps) / fps;

export function planSegmentRetake(input: SegmentRetakePlanInput): SegmentRetakePlan {
  const fps = Number.isFinite(input.fps) && (input.fps as number) > 0 ? (input.fps as number) : 24;
  const minGen = Number.isFinite(input.engineMinDurationS) && (input.engineMinDurationS as number) > 0
    ? (input.engineMinDurationS as number) : 3;
  const maxGen = Number.isFinite(input.engineMaxDurationS) && (input.engineMaxDurationS as number) > 0
    ? (input.engineMaxDurationS as number) : Infinity;

  const fail = (reason: string): SegmentRetakePlan => ({
    ok: false, reason, head: null, tail: null,
    patchFromS: 0, patchToS: 0, generateDurationS: 0, trimFromS: 0, trimToS: 0,
    totalAfterS: 0, padSeconds: 0,
  });

  const D = Number(input.shotDurationS);
  if (!Number.isFinite(D) || D <= 0) return fail('镜头时长无效');

  let a = snap(Number(input.fromS), fps);
  let b = snap(Number(input.toS), fps);
  const Dq = snap(D, fps);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fail('片段起止时间无效');
  if (a < 0) a = 0;
  if (b > Dq) b = Dq;
  // v12.314:倒着选要单独报 —— 落到「不足一帧」那条会让用户以为是选太短了,
  // 而实际是起止拖反了。也**不静默交换**:那会让用户以为自己选对了。
  if (b < a) return fail(`片段起止拖反了(${a.toFixed(2)}s → ${b.toFixed(2)}s),请重新框选`);
  if (b - a < 1 / fps) return fail('选区不足一帧,请拉长选区');

  const patchLen = snap(b - a, fps);

  // 引擎下限:不够就多生成一点,再从生成物里裁出需要的那段。
  // 优先向**后**多要(时间上更自然:补丁承接前文);后面不够再向前要。
  let generateDurationS = Math.max(patchLen, minGen);
  if (generateDurationS > maxGen) {
    return fail(`选区 ${patchLen.toFixed(2)}s 超过引擎单次上限 ${maxGen}s,请分两次重拍`);
  }
  const padSeconds = snap(generateDurationS - patchLen, fps);

  return {
    ok: true,
    head: a > 0 ? { fromS: 0, toS: a } : null,
    tail: b < Dq ? { fromS: b, toS: Dq } : null,
    patchFromS: a,
    patchToS: b,
    generateDurationS,
    // 生成物按下限拉长时,取**开头**那一段作为补丁 —— 多出来的尾巴丢弃
    trimFromS: 0,
    trimToS: patchLen,
    totalAfterS: Dq,   // 不变量:缝合后总长恒等于原镜时长
    padSeconds,
  };
}
