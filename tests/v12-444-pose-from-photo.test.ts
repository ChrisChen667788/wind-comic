/**
 * v12.444 —— 从参考照片认姿态与朝向(纯函数这一半)。
 *
 * 推理在浏览器里跑,但「认得准不准」不能只靠肉眼看一张图 —— 所以把关键点 → 姿态/朝向
 * 这一步写成纯函数,用**构造出来的人体关键点**逐个姿态验证。
 * 关键点编号与坐标口径沿用 MediaPipe Pose Landmarker:x 右、y 向下、都归一化到 [0,1]。
 */
import { describe, it, expect } from 'vitest';
import { classifyPose, facingFromLandmarks, readPoseFromLandmarks, type Landmark } from '@/lib/pose-from-photo';

const IDX = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;

/** 造一副 33 点的关键点;没给的点填到画面中心且可见度 0(= 认不出来的点) */
function body(parts: Partial<Record<keyof typeof IDX, [number, number, number?]>>): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  for (const [k, v] of Object.entries(parts) as Array<[keyof typeof IDX, [number, number, number?]]>) {
    lm[IDX[k]] = { x: v[0], y: v[1], visibility: v[2] ?? 1 };
  }
  return lm;
}

/** 站立骨架:肩 0.30、髋 0.50、膝 0.70、踝 0.90,双手垂在身侧 */
const STANDING = {
  nose: [0.5, 0.22] as [number, number], lShoulder: [0.38, 0.3] as [number, number], rShoulder: [0.62, 0.3] as [number, number],
  lWrist: [0.36, 0.55] as [number, number], rWrist: [0.64, 0.55] as [number, number],
  lHip: [0.43, 0.5] as [number, number], rHip: [0.57, 0.5] as [number, number],
  lKnee: [0.43, 0.7] as [number, number], rKnee: [0.57, 0.7] as [number, number],
  lAnkle: [0.43, 0.9] as [number, number], rAnkle: [0.57, 0.9] as [number, number],
};

describe('v12.444 · 认姿态', () => {
  it('站立', () => {
    const g = classifyPose(body(STANDING))!;
    expect(g.posePreset).toBe('standing');
    expect(g.why).toContain('站立');
  });

  it('坐:双膝约 90°', () => {
    const g = classifyPose(body({
      ...STANDING,
      lKnee: [0.30, 0.52], rKnee: [0.44, 0.52],      // 膝盖前伸、与髋同高
      lAnkle: [0.30, 0.75], rAnkle: [0.44, 0.75],    // 小腿垂下
    }))!;
    expect(g.posePreset).toBe('sitting');
  });

  it('跪:一腿折死、一腿伸着', () => {
    const g = classifyPose(body({
      ...STANDING,
      lKnee: [0.42, 0.62], lAnkle: [0.50, 0.58],     // 小腿折回到大腿后侧(约 58°)
      rKnee: [0.60, 0.68], rAnkle: [0.60, 0.88],     // 另一腿基本伸直
    }))!;
    expect(g.posePreset).toBe('kneeling');
  });

  it('蹲:双膝折得更狠且髋下沉', () => {
    const g = classifyPose(body({
      ...STANDING,
      lHip: [0.43, 0.62], rHip: [0.57, 0.62],
      lKnee: [0.32, 0.70], rKnee: [0.68, 0.70],
      lAnkle: [0.42, 0.72], rAnkle: [0.58, 0.72],
    }))!;
    expect(g.posePreset).toBe('crouching');
  });

  it('躺:躯干是横的', () => {
    const g = classifyPose(body({
      nose: [0.75, 0.62], lShoulder: [0.62, 0.6], rShoulder: [0.62, 0.66],
      lHip: [0.35, 0.6], rHip: [0.35, 0.66],
      lKnee: [0.2, 0.62], rKnee: [0.2, 0.66], lAnkle: [0.08, 0.62], rAnkle: [0.08, 0.66],
    }))!;
    expect(g.posePreset).toBe('lying');
    expect(g.why).toContain('横');
  });

  it('举手:一只腕高过肩', () => {
    const g = classifyPose(body({ ...STANDING, rWrist: [0.68, 0.12] }))!;
    expect(g.posePreset).toBe('arm-raised');
  });

  it('指向:手臂横伸、腕肩同高', () => {
    const g = classifyPose(body({ ...STANDING, rWrist: [0.92, 0.31] }))!;
    expect(g.posePreset).toBe('pointing');
  });

  it('掩面:双腕贴在脸旁', () => {
    const g = classifyPose(body({ ...STANDING, lWrist: [0.46, 0.24], rWrist: [0.54, 0.24] }))!;
    expect(g.posePreset).toBe('covering-face');
  });

  it('**认不出来就返回 null,绝不瞎猜**(点太少 / 关键点看不见)', () => {
    expect(classifyPose([])).toBeNull();
    expect(classifyPose(Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 })))).toBeNull();
    const blurred = body(STANDING);
    blurred[IDX.lShoulder] = { ...blurred[IDX.lShoulder], visibility: 0.1 };
    expect(classifyPose(blurred), '肩膀看不清就别猜姿态').toBeNull();
  });
});

describe('v12.444 · 认朝向', () => {
  it('正对镜头:肩线展开 + 看得见脸', () => {
    const f = facingFromLandmarks(body(STANDING))!;
    expect(f.facingDeg).toBe(180);
    expect(f.confidence).toBeGreaterThan(0.7);
  });

  it('侧身:肩线被压扁,脸偏哪边就朝哪边', () => {
    const right = facingFromLandmarks(body({ ...STANDING, lShoulder: [0.49, 0.3], rShoulder: [0.53, 0.3], nose: [0.58, 0.22] }))!;
    expect(right.facingDeg).toBe(90);
    const left = facingFromLandmarks(body({ ...STANDING, lShoulder: [0.47, 0.3], rShoulder: [0.51, 0.3], nose: [0.42, 0.22] }))!;
    expect(left.facingDeg).toBe(-90);
  });

  it('背对:肩线展开但看不到脸', () => {
    const f = facingFromLandmarks(body({ ...STANDING, nose: [0.5, 0.22, 0.1] }))!;
    expect(f.facingDeg).toBe(0);
    expect(f.why).toContain('背对');
  });

  it('侧身但看不到脸:仍给个方向,但置信度低到必须让用户确认', () => {
    const f = facingFromLandmarks(body({ ...STANDING, lShoulder: [0.49, 0.3], rShoulder: [0.53, 0.3], nose: [0.5, 0.22, 0.1] }))!;
    expect(f.confidence).toBeLessThan(0.5);
  });
});

describe('v12.444 · 合起来读一张照片', () => {
  it('姿态 + 朝向一起给,置信度取两者较低的那个', () => {
    const r = readPoseFromLandmarks(body({ ...STANDING, rWrist: [0.68, 0.12], nose: [0.5, 0.22, 0.1] }))!;
    expect(r.posePreset).toBe('arm-raised');
    expect(r.facingDeg).toBe(0);
    expect(r.confidence).toBeLessThanOrEqual(0.6);
    expect(r.why).toBeTruthy();
    expect(r.facingWhy).toContain('背对');
  });

  it('姿态认不出 → 整体 null(只给朝向没有意义)', () => {
    expect(readPoseFromLandmarks([])).toBeNull();
  });
});
