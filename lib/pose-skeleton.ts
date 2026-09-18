/**
 * lib/pose-skeleton — 姿态预设 → **画面里的身体轮廓**(v12.443)。
 *
 * v12.441 让姿态进了提示词,但构图草图里每个人仍是「一根矩形 + 一个圆头」——
 * 坐着的人和站着的人画出来一模一样,而草图锁正是拿这张图去约束构图的。
 *
 * 这里只做两件事,都是**几何事实**,不是美术:
 *   ① `heightFactor`:坐/跪/蹲/躺的人,头顶比站着低 —— 这会真实改变他在画面里的高度与景别;
 *   ② `limbs`:四肢的折线(躯干由草图层画矩形),让草图能看出「他在干什么」。
 *
 * 坐标约定(与草图层无关的纯身体坐标):
 *   x:以**身体宽度**为单位,0 = 中轴,±0.5 = 躯干左右边缘,可以超出(伸手/指向);
 *   y:0 = 脚底,1 = 头顶(按该姿态**已经缩短后**的高度算)。
 * 这样草图层只需把 (x, y) 乘上画面里的身宽/身高即可,不必知道任何姿态细节。
 */
import type { PosePresetId } from './stage-blocking';

export interface PoseSkeleton {
  /** 相对站立的头顶高度倍数(坐 0.72、跪 0.62、蹲 0.55、躺 0.18) */
  heightFactor: number;
  /** 躯干矩形的上下沿(y) */
  torsoTop: number;
  torsoBottom: number;
  /** 四肢折线;每条至少两点 */
  limbs: Array<Array<[number, number]>>;
  /** 躺倒:身体横过来,草图层按横向矩形画 */
  horizontal?: boolean;
}

/** 站姿基准:肩 0.78、髋 0.5、手垂到 0.28、脚在 0 */
const STAND_ARMS: Array<Array<[number, number]>> = [
  // 手臂比躯干宽一点才看得出来是手臂(躯干半宽 0.5,手臂走到 0.68)
  [[-0.45, 0.78], [-0.68, 0.52], [-0.62, 0.3]],
  [[0.45, 0.78], [0.68, 0.52], [0.62, 0.3]],
];
const STAND_LEGS: Array<Array<[number, number]>> = [
  [[-0.2, 0.5], [-0.22, 0.25], [-0.24, 0]],
  [[0.2, 0.5], [0.22, 0.25], [0.24, 0]],
];

export const POSE_SKELETONS: Record<PosePresetId, PoseSkeleton> = {
  standing: { heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5, limbs: [...STAND_ARMS, ...STAND_LEGS] },
  // 走:一腿前一腿后,手臂前后摆
  walking: {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[-0.45, 0.78], [-0.6, 0.55], [-0.55, 0.34]],
      [[0.45, 0.78], [0.62, 0.58], [0.7, 0.4]],
      [[-0.2, 0.5], [-0.42, 0.26], [-0.55, 0]],
      [[0.2, 0.5], [0.3, 0.26], [0.34, 0]],
    ],
  },
  // 跑:跨步更大、手臂弯折
  running: {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.52,
    limbs: [
      [[-0.45, 0.78], [-0.75, 0.66], [-0.55, 0.5]],
      [[0.45, 0.78], [0.75, 0.62], [0.6, 0.44]],
      [[-0.2, 0.52], [-0.6, 0.34], [-0.85, 0.12]],
      [[0.2, 0.52], [0.45, 0.3], [0.3, 0.08]],
    ],
  },
  leaning: {
    heightFactor: 0.97, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[-0.45, 0.78], [-0.75, 0.7], [-0.9, 0.62]],   // 一只手撑在侧面
      [[0.45, 0.78], [0.5, 0.52], [0.45, 0.3]],
      [[-0.2, 0.5], [-0.3, 0.25], [-0.42, 0]],
      [[0.2, 0.5], [0.24, 0.25], [0.22, 0]],
    ],
  },
  'arms-crossed': {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[-0.45, 0.76], [-0.5, 0.66], [0.25, 0.62]],
      [[0.45, 0.76], [0.5, 0.66], [-0.25, 0.6]],
      ...STAND_LEGS,
    ],
  },
  'hands-on-hips': {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[-0.45, 0.76], [-0.78, 0.64], [-0.4, 0.52]],
      [[0.45, 0.76], [0.78, 0.64], [0.4, 0.52]],
      ...STAND_LEGS,
    ],
  },
  'arm-raised': {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[0.45, 0.78], [0.6, 0.95], [0.62, 1.15]],     // 高举过头顶
      [[-0.45, 0.78], [-0.55, 0.52], [-0.5, 0.3]],
      ...STAND_LEGS,
    ],
  },
  pointing: {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[0.45, 0.78], [0.85, 0.79], [1.25, 0.8]],     // 手臂水平伸直
      [[-0.45, 0.78], [-0.55, 0.52], [-0.5, 0.3]],
      ...STAND_LEGS,
    ],
  },
  reaching: {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[0.45, 0.78], [0.8, 0.86], [1.1, 0.92]],      // 向前上方伸手
      [[-0.45, 0.78], [-0.55, 0.52], [-0.5, 0.3]],
      ...STAND_LEGS,
    ],
  },
  'covering-face': {
    heightFactor: 1, torsoTop: 0.82, torsoBottom: 0.5,
    limbs: [
      [[-0.45, 0.78], [-0.5, 0.9], [-0.18, 0.95]],   // 双手抬到脸前
      [[0.45, 0.78], [0.5, 0.9], [0.18, 0.95]],
      ...STAND_LEGS,
    ],
  },
  'head-down': {
    heightFactor: 0.96, torsoTop: 0.8, torsoBottom: 0.5,
    limbs: [
      [[-0.45, 0.74], [-0.52, 0.5], [-0.48, 0.28]],
      [[0.45, 0.74], [0.52, 0.5], [0.48, 0.28]],
      ...STAND_LEGS,
    ],
  },
  // 坐:大腿前伸、小腿垂下 —— 头顶明显低于站立
  sitting: {
    heightFactor: 0.72, torsoTop: 0.82, torsoBottom: 0.42,
    limbs: [
      [[-0.45, 0.76], [-0.55, 0.58], [-0.3, 0.44]],
      [[0.45, 0.76], [0.55, 0.58], [0.3, 0.44]],
      [[-0.15, 0.42], [0.55, 0.4], [0.6, 0]],
      [[0.15, 0.42], [0.8, 0.4], [0.85, 0]],
    ],
  },
  kneeling: {
    heightFactor: 0.62, torsoTop: 0.82, torsoBottom: 0.4,
    limbs: [
      [[-0.45, 0.76], [-0.55, 0.55], [-0.45, 0.36]],
      [[0.45, 0.76], [0.55, 0.55], [0.45, 0.36]],
      [[-0.15, 0.4], [-0.2, 0.12], [-0.45, 0]],      // 一膝跪地
      [[0.15, 0.4], [0.62, 0.3], [0.68, 0]],         // 另一腿撑起
    ],
  },
  crouching: {
    heightFactor: 0.55, torsoTop: 0.82, torsoBottom: 0.45,
    limbs: [
      [[-0.45, 0.74], [-0.6, 0.55], [-0.45, 0.38]],
      [[0.45, 0.74], [0.6, 0.55], [0.45, 0.38]],
      [[-0.18, 0.45], [-0.6, 0.3], [-0.35, 0]],
      [[0.18, 0.45], [0.6, 0.3], [0.35, 0]],
    ],
  },
  // 躺:身体横过来。四肢留空 —— 这个尺度下的横向躯干 + 一端的头已经足够读出「躺着」,
  // 再画两条斜线反而像是从身体里伸出去的东西(实渲对比过)。
  lying: { heightFactor: 0.18, horizontal: true, torsoTop: 1, torsoBottom: 0, limbs: [] },
};

/** 该姿态下头顶相对站立的倍数;未设 / 不认识 → 1(站立) */
export function poseHeightFactor(preset: PosePresetId | undefined): number {
  const s = preset && Object.prototype.hasOwnProperty.call(POSE_SKELETONS, preset) ? POSE_SKELETONS[preset] : null;
  return s ? s.heightFactor : 1;
}

/** 该姿态的骨架;未设 / 不认识 → null(草图层退回修前的「矩形 + 圆头」) */
export function poseSkeletonOf(preset: PosePresetId | undefined): PoseSkeleton | null {
  return preset && Object.prototype.hasOwnProperty.call(POSE_SKELETONS, preset) ? POSE_SKELETONS[preset] : null;
}

/** 3D 人偶的一段肢体:两端点在「人偶局部坐标」里(x 右、y 上、z 前),单位米 */
export type Limb3D = [[number, number, number], [number, number, number]];

export interface Mannequin3D {
  /** 该姿态下人偶的实际高度(米)—— 与 `projectScene` 用的是同一个 heightFactor */
  heightM: number;
  /** 四肢线段;没设姿态时为空数组(人偶保持 v12.440 的胶囊 + 圆头,不暗示任何姿态) */
  limbs: Limb3D[];
  /** 躺倒:调用方把人偶整体放倒 */
  lying: boolean;
  /** 躯干上下沿(米,从脚底算)—— 胶囊按这一段画 */
  torsoTopM: number;
  torsoBottomM: number;
}

/**
 * 姿态 → 3D 人偶(v12.445)。
 *
 * **与草图共用同一张骨架表**:草图与 3D 视口画的必须是同一个人 ——
 * 否则用户在 3D 里看到举手、草图里却是站着,又是「同一语义两套口径」。
 * 2D 骨架的 x 以身宽为单位、y 是身高比例,这里乘上人偶的实际尺寸落到米。
 * z 一律 0(贴着人偶的正面平面):单目参考图本来就给不出深度,假装有 z 是无依据的精细。
 */
export function mannequin3D(standHeightM: number, preset: PosePresetId | undefined): Mannequin3D {
  const skel = poseSkeletonOf(preset);
  const heightM = standHeightM * (skel?.heightFactor ?? 1);
  if (!skel) {
    return { heightM, limbs: [], lying: false, torsoTopM: heightM * 0.82, torsoBottomM: heightM * 0.5 };
  }
  const bodyW = standHeightM * 0.22;   // 身宽约身高的 0.22(与草图里 bodyH*0.26 的观感一致)
  const toLocal = ([bx, by]: [number, number]): [number, number, number] => [bx * bodyW, by * heightM, 0];
  const limbs: Limb3D[] = [];
  for (const limb of skel.limbs) {
    for (let i = 1; i < limb.length; i++) limbs.push([toLocal(limb[i - 1]), toLocal(limb[i])]);
  }
  return {
    heightM,
    limbs,
    lying: !!skel.horizontal,
    torsoTopM: heightM * skel.torsoTop,
    torsoBottomM: heightM * skel.torsoBottom,
  };
}
