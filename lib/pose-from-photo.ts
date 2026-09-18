/**
 * lib/pose-from-photo — 从参考照片的人体关键点**认出姿态与朝向**(v12.444)。
 *
 * 这一层是**纯函数**:输入 33 个归一化关键点(MediaPipe Pose Landmarker 的输出口径),
 * 输出导演台已有的两个字段 —— `posePreset`(v12.441 的词表)与 `facingDeg`(v12.440 的朝向)。
 * 推理本身在浏览器里跑(见 `components/project/pose-photo-button`),这里不碰任何模型、
 * 不碰 DOM,所以能被测试直接喂数据验证 —— 否则「认得准不准」就只能靠肉眼看。
 *
 * 关键点编号沿用 MediaPipe 的约定(0 鼻、11/12 肩、13/14 肘、15/16 腕、23/24 髋、
 * 25/26 膝、27/28 踝),坐标已归一化到 [0,1]:x 向右、y **向下**、z 越负越靠近镜头。
 *
 * 判据都写成**可解释的几何比值**而不是阈值魔法数堆砌:
 *   躯干向量的倾角决定站/躺;髋-膝-踝的折叠程度决定坐/跪/蹲;手腕相对肩/头的位置决定举手/指向/掩面。
 * 认不出来就返回 null —— 宁可让用户自己选,也不要猜一个塞进提示词(那会直接影响出片)。
 */
import type { PosePresetId } from './stage-blocking';

export interface Landmark { x: number; y: number; z?: number; visibility?: number }

export interface PoseGuess {
  posePreset: PosePresetId;
  /** 身体朝向(度),与 `StageActor.facingDeg` 同一约定;认不准则不给 */
  facingDeg?: number;
  /** 0~1;低于 0.45 时界面必须提示用户自己确认 */
  confidence: number;
  /** 判据(中文,给界面显示「凭什么这么认」) */
  why: string;
}

const L = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;

const mid = (a: Landmark, b: Landmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
/** 关键点可见度(MediaPipe 给的置信度);没给就当可见 */
const vis = (p?: Landmark) => (p && typeof p.visibility === 'number' ? p.visibility : 1);

/** 三点夹角(度):b 为顶点 */
function angleAt(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.sqrt(v1x * v1x + v1y * v1y), n2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (n1 < 1e-9 || n2 < 1e-9) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * 由双肩的横向跨度与鼻子的偏移估朝向。
 *
 * 正对镜头时双肩跨度最大、鼻子居中;侧身时肩膀在画面里被压扁、鼻子偏向一侧。
 * 只能给出「正面 / 侧面朝左 / 侧面朝右 / 背面」这个粒度 —— 单目照片里更细的角度不可靠,
 * 所以返回的是四个代表角,而不是假装精确到度。背面靠「鼻子不可见 + 肩宽仍大」判。
 */
export function facingFromLandmarks(lm: Landmark[]): { facingDeg: number; confidence: number; why: string } | null {
  const ls = lm[L.lShoulder], rs = lm[L.rShoulder], nose = lm[L.nose];
  if (!ls || !rs) return null;
  const shoulderSpan = Math.abs(ls.x - rs.x);
  const torso = dist(mid(ls, rs), mid(lm[L.lHip] ?? ls, lm[L.rHip] ?? rs));
  if (torso < 1e-6) return null;
  const ratio = shoulderSpan / torso;            // 正对约 ≥0.8,侧身 ≤0.35
  const noseVisible = vis(nose) > 0.5;

  if (ratio < 0.35) {
    // 侧身:鼻子在肩中点的哪一侧,就朝哪边
    const c = mid(ls, rs);
    const toward = noseVisible ? Math.sign(nose.x - c.x) : 0;
    if (toward === 0) return { facingDeg: 90, confidence: 0.45, why: '肩线被压扁判为侧身,但看不到脸,左右取右侧' };
    // 画面右 = 舞台朝向 +90(与 v12.440 的 screenSide 同一口径:机位在 −z 方向看过来)
    return { facingDeg: toward > 0 ? 90 : -90, confidence: 0.7, why: `肩线压扁(肩宽/躯干=${ratio.toFixed(2)})且脸偏向画面${toward > 0 ? '右' : '左'}` };
  }
  if (!noseVisible) return { facingDeg: 0, confidence: 0.6, why: '肩线展开但看不到脸 —— 判为背对镜头' };
  return { facingDeg: 180, confidence: 0.8, why: `肩线展开(肩宽/躯干=${ratio.toFixed(2)})且看得到脸 —— 正对镜头` };
}

/**
 * 认姿态。判据顺序:先看整体躯干朝向(躺),再看下肢折叠(坐/跪/蹲),最后看上肢(举手/指向/掩面/抱臂/叉腰)。
 * 都不像就回 `standing`;关键点缺失或可见度太低直接返回 null(**不猜**)。
 */
export function classifyPose(lm: Landmark[]): PoseGuess | null {
  const need = [L.lShoulder, L.rShoulder, L.lHip, L.rHip];
  if (lm.length < 29 || need.some((i) => !lm[i] || vis(lm[i]) < 0.3)) return null;

  const sh = mid(lm[L.lShoulder], lm[L.rShoulder]);
  const hip = mid(lm[L.lHip], lm[L.rHip]);
  const torsoLen = dist(sh, hip);
  if (torsoLen < 1e-6) return null;
  // 躯干与竖直方向的夹角:0 = 直立,90 = 横躺
  const tilt = (Math.atan2(Math.abs(hip.x - sh.x), Math.abs(hip.y - sh.y)) * 180) / Math.PI;

  if (tilt > 55) return { posePreset: 'lying', confidence: 0.75, why: `躯干与竖直方向差 ${tilt.toFixed(0)}° —— 身体是横的` };

  const kneeAngle = (side: 'l' | 'r') => {
    const h = lm[side === 'l' ? L.lHip : L.rHip], k = lm[side === 'l' ? L.lKnee : L.rKnee], a = lm[side === 'l' ? L.lAnkle : L.rAnkle];
    return h && k && a && vis(k) > 0.3 && vis(a) > 0.3 ? angleAt(h, k, a) : null;
  };
  const knees = [kneeAngle('l'), kneeAngle('r')].filter((v): v is number => v !== null);
  const hipDrop = (lm[L.lKnee]?.y ?? hip.y) - hip.y;   // 髋到膝的竖直落差(归一化)

  if (knees.length > 0) {
    const bent = Math.min(...knees);
    const both = knees.length === 2 ? Math.max(...knees) : bent;
    // 坐:膝盖约 90°、两腿都折;蹲:折得更狠且髋明显下沉;跪:一腿折死一腿撑着
    if (bent < 60 && hipDrop < torsoLen * 0.35) {
      return { posePreset: 'crouching', confidence: 0.6, why: `双膝折到 ${bent.toFixed(0)}° 且髋部明显下沉 —— 蹲` };
    }
    if (bent < 105 && both < 130) {
      return { posePreset: 'sitting', confidence: 0.65, why: `双膝约 ${bent.toFixed(0)}°/${both.toFixed(0)}° —— 坐` };
    }
    if (bent < 105 && both >= 130) {
      return { posePreset: 'kneeling', confidence: 0.55, why: `一腿折到 ${bent.toFixed(0)}°、另一腿伸着 ${both.toFixed(0)}° —— 跪` };
    }
  }

  // 上肢:腕相对肩/头的位置
  const arm = (side: 'l' | 'r') => {
    const s = lm[side === 'l' ? L.lShoulder : L.rShoulder];
    const w = lm[side === 'l' ? L.lWrist : L.rWrist];
    if (!s || !w || vis(w) < 0.3) return null;
    return { above: s.y - w.y, out: Math.abs(w.x - s.x), w, s };
  };
  const arms = [arm('l'), arm('r')].filter((v): v is NonNullable<ReturnType<typeof arm>> => v !== null);
  const nose = lm[L.nose];

  if (arms.length === 2 && nose && vis(nose) > 0.4
      && arms.every((a) => dist(a.w, nose) < torsoLen * 0.55 && a.above > -torsoLen * 0.15)) {
    return { posePreset: 'covering-face', confidence: 0.6, why: '双腕都贴在脸附近 —— 掩面' };
  }
  const raised = arms.find((a) => a.above > torsoLen * 0.45);
  if (raised) return { posePreset: 'arm-raised', confidence: 0.7, why: '有一只手腕高过肩膀半个躯干以上 —— 举手' };

  const extended = arms.find((a) => a.out > torsoLen * 0.75 && Math.abs(a.above) < torsoLen * 0.3);
  if (extended) return { posePreset: 'pointing', confidence: 0.55, why: '手臂横向伸直、腕与肩基本同高 —— 指向' };

  if (arms.length === 2 && arms.every((a) => a.out < torsoLen * 0.25 && a.above > 0 && a.above < torsoLen * 0.6)
      && dist(arms[0].w, arms[1].w) < torsoLen * 0.5) {
    return { posePreset: 'arms-crossed', confidence: 0.5, why: '双腕都收在胸前且彼此靠近 —— 抱臂' };
  }
  if (arms.length === 2 && arms.every((a) => a.out > torsoLen * 0.3 && Math.abs(a.above) < torsoLen * 0.25)) {
    return { posePreset: 'hands-on-hips', confidence: 0.5, why: '双腕都在髋侧、肘向外张 —— 叉腰' };
  }

  return { posePreset: 'standing', confidence: 0.5, why: '躯干直立、四肢没有明显特征 —— 站立' };
}

/** 一次拿到姿态 + 朝向;姿态认不出就整体返回 null(朝向单独给意义不大) */
export function readPoseFromLandmarks(lm: Landmark[]): (PoseGuess & { facingWhy?: string }) | null {
  const pose = classifyPose(lm);
  if (!pose) return null;
  const f = facingFromLandmarks(lm);
  if (!f) return pose;
  return { ...pose, facingDeg: f.facingDeg, facingWhy: f.why, confidence: Math.min(pose.confidence, f.confidence) };
}
