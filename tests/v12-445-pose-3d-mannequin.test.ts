/**
 * v12.445 —— 3D 人偶也吃姿态:变矮、放倒、长出四肢。
 *
 * v12.443 让几何与草图认了姿态,**3D 人偶没跟上** —— 坐着的人在提示词里是坐着、在草图里矮一截,
 * 在 3D 视口里却还站得笔直。这正是本仓栽过五次的「同一语义两套口径」:
 * 用户在 3D 里摆完位看着对,出片却按另一套来。
 *
 * 所以这一版的核心断言不是「画得好不好看」,而是:**3D 人偶与草图、几何共用同一张骨架表**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mannequin3D, POSE_SKELETONS, poseHeightFactor } from '@/lib/pose-skeleton';
import { projectScene, verticalFovDeg, POSE_PRESETS, type StageScene, type PosePresetId } from '@/lib/stage-blocking';

const STAND_H = 1.7;

describe('v12.445 · 人偶高度与几何同源', () => {
  it('每个姿态的人偶高度 = 站立身高 × 同一个 heightFactor', () => {
    for (const id of Object.keys(POSE_PRESETS) as PosePresetId[]) {
      expect(mannequin3D(STAND_H, id).heightM).toBeCloseTo(STAND_H * poseHeightFactor(id), 9);
    }
  });

  it('未设姿态 / 词表外:人偶与 v12.440 一样高,且不长四肢(不暗示没有的东西)', () => {
    for (const p of [undefined, 'moonwalk' as PosePresetId]) {
      const m = mannequin3D(STAND_H, p);
      expect(m.heightM).toBe(STAND_H);
      expect(m.limbs).toHaveLength(0);
      expect(m.lying).toBe(false);
    }
  });

  it('**人偶高度与投影里的头顶一致**(坐下时两边一起变矮,不能只变一边)', () => {
    const scene = (posePreset?: PosePresetId): StageScene => ({
      camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 }, aspect: '16:9',
      actors: [{ id: 'a', x: 0, z: 5, heightM: STAND_H, posePreset }],
    });
    const standTop = projectScene(scene('standing'))[0].screenTop;
    const sitTop = projectScene(scene('sitting'))[0].screenTop;
    expect(sitTop).toBeLessThan(standTop);
    // 从投影反解头顶高度:screenTop = (h − 机位高) / (深度 × tan(半竖向视角)) —— 反解出来的 h
    // 必须与人偶高度逐一对上(两处都乘同一个 heightFactor,否则这条必红)
    const camH = 1.6, depth = 5;
    const tanHalfV = Math.tan((verticalFovDeg('35', '16:9') * Math.PI) / 360);
    const headOf = (top: number) => top * depth * tanHalfV + camH;
    // 精度 3 位:projectScene 的 screenTop 存的是 4 位小数(反解回来必然带这点舍入)
    expect(headOf(standTop)).toBeCloseTo(mannequin3D(STAND_H, 'standing').heightM, 3);
    expect(headOf(sitTop)).toBeCloseTo(mannequin3D(STAND_H, 'sitting').heightM, 3);
  });
});

describe('v12.445 · 四肢与躺倒', () => {
  it('举手:有肢体端点高过头顶;站立时最高的肢体点不超过头顶', () => {
    const top = (id: PosePresetId) => Math.max(...mannequin3D(STAND_H, id).limbs.flat().map((p) => p[1]));
    expect(top('arm-raised')).toBeGreaterThan(mannequin3D(STAND_H, 'arm-raised').heightM);
    expect(top('standing')).toBeLessThanOrEqual(mannequin3D(STAND_H, 'standing').heightM);
  });

  it('指向:有肢体端点横向伸出身宽之外', () => {
    const wide = (id: PosePresetId) => Math.max(...mannequin3D(STAND_H, id).limbs.flat().map((p) => Math.abs(p[0])));
    expect(wide('pointing')).toBeGreaterThan(wide('standing') * 1.5);
  });

  it('躺倒:标记为躺,且高度压到站立的两成以下', () => {
    const m = mannequin3D(STAND_H, 'lying');
    expect(m.lying).toBe(true);
    expect(m.heightM).toBeLessThan(STAND_H * 0.2);
    expect(mannequin3D(STAND_H, 'standing').lying).toBe(false);
  });

  it('所有肢体点都贴在人偶正面平面上(单目参考图给不出深度,不假装有 z)', () => {
    for (const id of Object.keys(POSE_PRESETS) as PosePresetId[]) {
      for (const p of mannequin3D(STAND_H, id).limbs.flat()) expect(p[2]).toBe(0);
    }
  });

  it('躯干上下沿在合理范围,且上沿高于下沿', () => {
    for (const id of Object.keys(POSE_PRESETS) as PosePresetId[]) {
      const m = mannequin3D(STAND_H, id);
      if (m.lying) continue;
      expect(m.torsoTopM, id).toBeGreaterThan(m.torsoBottomM);
      expect(m.torsoTopM, id).toBeLessThanOrEqual(m.heightM);
      expect(m.torsoBottomM, id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('v12.445 · 景别按身量,不按姿态压过的高度(浏览器实测撞到的)', () => {
  const at = (posePreset: PosePresetId | undefined, z: number): StageScene => ({
    camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 }, aspect: '16:9',
    actors: [{ id: 'a', x: 0, z, heightM: STAND_H, posePreset }],
  });
  it('同一距离上,坐/跪/蹲/躺与站立的景别相同', () => {
    const stand = projectScene(at('standing', 5))[0].shotSize;
    for (const id of ['sitting', 'kneeling', 'crouching', 'lying'] as PosePresetId[]) {
      expect(projectScene(at(id, 5))[0].shotSize, `${id} 没有变远变小,景别不该变`).toBe(stand);
    }
  });
  it('但距离真的变了,景别照常跟着变(别把判据改死)', () => {
    expect(projectScene(at('sitting', 1.5))[0].shotSize).not.toBe(projectScene(at('sitting', 12))[0].shotSize);
  });
  it('轮廓仍按姿态压过的高度:坐着头顶更低', () => {
    expect(projectScene(at('sitting', 5))[0].screenTop).toBeLessThan(projectScene(at('standing', 5))[0].screenTop);
  });
});

describe('v12.445 · 接线:3D 视口真的用了这张表', () => {
  const SRC = fs.readFileSync('components/project/stage3d-viewport.tsx', 'utf-8');

  it('人偶从 mannequin3D 拿高度与四肢,而不是自己另算一套', () => {
    expect(SRC).toContain("import { mannequin3D } from '@/lib/pose-skeleton'");
    expect(SRC).toMatch(/const m = mannequin3D\(standH, actor\.posePreset\)/);
    expect(SRC, '四肢要真画出来').toMatch(/m\.limbs\.map\(/);
    expect(SRC, '躺倒要真放倒').toMatch(/m\.lying \? \[-Math\.PI \/ 2/);
  });

  it('草图与 3D 用的是同一张骨架表(改一处两处都变)', () => {
    const sketch = fs.readFileSync('lib/stage-sketch.ts', 'utf-8');
    expect(sketch).toContain("from './pose-skeleton'");
    const table = fs.readFileSync('lib/pose-skeleton.ts', 'utf-8');
    expect((table.match(/export const POSE_SKELETONS/g) || []).length, '骨架表只能有一份').toBe(1);
    expect(Object.keys(POSE_SKELETONS).length).toBe(Object.keys(POSE_PRESETS).length);
  });
});
