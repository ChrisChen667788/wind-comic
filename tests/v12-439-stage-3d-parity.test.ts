/**
 * v12.439 —— 3D 导演台的地基:空间模型必须与真实相机数值一致。
 *
 * 给导演台加 3D 视口之前,先查出现有空间模型有三处几何错误(都已数值验证):
 *   ① 投影按「角度线性」(rel / half),真实镜头与 three.js 是直线透视 tan(rel)/tan(half)。
 *      只在画面正中与边缘重合,中间错开 —— 18mm 下错 4.3% 画幅,35mm 1.5%。
 *   ② 完全不看画幅,永远按 36×24(3:2)算。库里 84% 的项目是 9:16,35mm 下真实水平视角 32.3°,
 *      模型按 54.4° 算,把画面宽度高估约 68%:体检漏报出画,提示词把画外的人说成在画内。
 *   ③ 纵向用水平距离而非沿光轴的深度 —— 偏离中心 20° 时纵向位置差约 6%。
 *      这一条设计评审与三份独立设计**全都漏了**:它们的数值验证只核了水平 x。
 *
 * 所以这里不自己写一个「参考投影器」去比(那是拿同一个公式比同一个公式,测不出错),
 * 而是直接对照 three.js 的 PerspectiveCamera —— 也就是 3D 视口里真正用的那台相机。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  projectScene, sensorDims, horizontalFovDeg, verticalFovDeg, inferShotSize, auditStaging,
  type StageScene,
} from '@/lib/stage-blocking';
import type { LensId } from '@/lib/cinematography';

const rad = (d: number) => (d * Math.PI) / 180;
const LENS_MM: Record<string, number> = { '18': 18, '24': 24, '35': 35, '50': 50, '85': 85 };

/** 舞台坐标(x 右、z 前、y 高)→ three.js(相机默认看 -Z):z 取反。朝向 yaw 顺时针为正。 */
function threeCamera(scene: StageScene): THREE.PerspectiveCamera {
  const c = scene.camera;
  const { sW, sH } = sensorDims(scene.aspect);
  const cam = new THREE.PerspectiveCamera(verticalFovDeg(c.lens, scene.aspect), sW / sH, 0.01, 1000);
  cam.position.set(c.x, c.heightM ?? 1.6, -c.z);
  cam.lookAt(new THREE.Vector3(c.x + Math.sin(rad(c.yawDeg)), c.heightM ?? 1.6, -(c.z + Math.cos(rad(c.yawDeg)))));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
const ndc = (cam: THREE.PerspectiveCamera, x: number, y: number, z: number) => new THREE.Vector3(x, y, -z).project(cam);

/** 以机位朝向为基准摆一个人:前方 fwd 米、侧向偏 side 米(保证在机位前方) */
function placeRelative(camX: number, camZ: number, yaw: number, fwd: number, side: number) {
  return {
    x: camX + side * Math.cos(rad(yaw)) + fwd * Math.sin(rad(yaw)),
    z: camZ - side * Math.sin(rad(yaw)) + fwd * Math.cos(rad(yaw)),
  };
}

const ASPECTS = [undefined, '16:9', '9:16', '1:1', '2.35:1'];
const LENSES: LensId[] = ['18', '24', '35', '50', '85'];

describe('v12.439 · 画幅建模:长边固定 36mm', () => {
  it('各画幅的等效传感器', () => {
    expect(sensorDims(undefined)).toEqual({ sW: 36, sH: 24 }); // 修前行为
    expect(sensorDims('16:9')).toEqual({ sW: 36, sH: 20.25 });
    expect(sensorDims('9:16')).toEqual({ sW: 20.25, sH: 36 });
    expect(sensorDims('1:1')).toEqual({ sW: 36, sH: 36 });
    expect(sensorDims('2.35:1').sW).toBe(36);
    expect(sensorDims('2.35:1').sH).toBeCloseTo(15.319, 3);
  });

  it('脏值退回修前的 3:2,不抛错', () => {
    for (const bad of ['', 'abc', '16x9', '0:9', '9:0', ':', null, '-16:9']) {
      expect(sensorDims(bad as any)).toEqual({ sW: 36, sH: 24 });
    }
  });

  it('35mm:16:9 水平 54.4°(与 3:2 同宽),9:16 水平 32.3°', () => {
    expect(horizontalFovDeg('35', '16:9')).toBeCloseTo(54.43, 2);
    expect(horizontalFovDeg('35', undefined)).toBeCloseTo(54.43, 2);
    expect(horizontalFovDeg('35', '9:16')).toBeCloseTo(32.27, 2);
    expect(verticalFovDeg('35', '9:16')).toBeCloseTo(54.43, 2);
    expect(verticalFovDeg('35', undefined)).toBeCloseTo(37.85, 2); // 修前行为
  });
});

describe('v12.439 · 与 three.js PerspectiveCamera 数值一致(水平 + 纵向,含偏离中心的人)', () => {
  it('5 种画幅 × 5 个焦距 × 3 个机位朝向 × 4 个位置 × 2 种机位高度,screenX/screenTop/screenBottom 全部一致', () => {
    let n = 0;
    let worst = 0;
    for (const aspect of ASPECTS) {
      for (const lens of LENSES) {
        const halfH = horizontalFovDeg(lens, aspect) / 2;
        for (const yaw of [0, 35, -70]) {
          for (const camH of [0.5, 2.8]) {
            const camX = 0.4, camZ = -1.1;
            // 位置刻意包含偏离中心的:偏角取半视角的 0 / 0.45 / 0.8 / -0.7
            for (const frac of [0, 0.45, 0.8, -0.7]) {
              const fwd = 5;
              const side = fwd * Math.tan(rad(halfH * frac));
              const { x, z } = placeRelative(camX, camZ, yaw, fwd, side);
              const scene: StageScene = { aspect, camera: { x: camX, z: camZ, heightM: camH, yawDeg: yaw, lens }, actors: [{ id: 'a', x, z, heightM: 1.7 }] };
              const [p] = projectScene(scene);
              const cam = threeCamera(scene);
              const head = ndc(cam, x, 1.7, z);
              const feet = ndc(cam, x, 0, z);
              const e = Math.max(Math.abs(p.screenX - head.x), Math.abs(p.screenTop - head.y), Math.abs(p.screenBottom - feet.y));
              worst = Math.max(worst, e);
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(600);
    expect(worst).toBeLessThan(1e-3); // projectScene 输出保留 4 位小数,误差上限由取整决定
  });
});

describe('v12.439 · 修正确实有必要(旧公式与真实相机不一致)', () => {
  const scene: StageScene = { aspect: '16:9', camera: { x: 0, z: 0, heightM: 1.6, yawDeg: 0, lens: '18' }, actors: [] };

  it('旧的角度线性横向公式:18mm、偏半视角一半时,与真实相机差 > 0.08', () => {
    const half = horizontalFovDeg('18', '16:9') / 2;
    const rel = half / 2;
    const { x, z } = placeRelative(0, 0, 0, 5, 5 * Math.tan(rad(rel)));
    const truth = ndc(threeCamera(scene), x, 1.6, z).x;
    const oldFormula = rel / half;
    expect(Math.abs(oldFormula - truth)).toBeGreaterThan(0.08);
    const [p] = projectScene({ ...scene, actors: [{ id: 'a', x, z }] });
    expect(Math.abs(p.screenX - truth)).toBeLessThan(1e-3);
  });

  it('纵向若用水平距离而非光轴深度:偏离中心时与真实相机明显不一致', () => {
    // 35mm 9:16,人偏在画面接近边缘处 —— 评审给的「直接公式」用的就是水平距离
    const s: StageScene = { aspect: '9:16', camera: { x: 0, z: 0, heightM: 0.6, yawDeg: 0, lens: '35' }, actors: [] };
    const half = horizontalFovDeg('35', '9:16') / 2;
    const { x, z } = placeRelative(0, 0, 0, 4, 4 * Math.tan(rad(half * 0.9)));
    const dist = Math.hypot(x, z);
    const tanHalfV = Math.tan(rad(verticalFovDeg('35', '9:16') / 2));
    const withHorizontalDistance = (1.7 - 0.6) / (dist * tanHalfV);
    const truth = ndc(threeCamera(s), x, 1.7, z).y;
    expect(Math.abs(withHorizontalDistance - truth)).toBeGreaterThan(0.01);
    const [p] = projectScene({ ...s, actors: [{ id: 'a', x, z, heightM: 1.7 }] });
    expect(Math.abs(p.screenTop - truth)).toBeLessThan(1e-3);
  });
});

describe('v12.439 · 9:16 的出画判定终于对了', () => {
  it('偏 22° 的人:3:2 模型说在画内,9:16 实际已出画,体检报警', () => {
    const base = { camera: { x: 0, z: 0, heightM: 1.6, yawDeg: 0, lens: '35' as LensId }, actors: [{ id: 'a', name: '林夜', ...placeRelative(0, 0, 0, 5, 5 * Math.tan(rad(22))) }] };
    const [legacy] = projectScene({ ...base }); // 无画幅 → 3:2,半视角 27.2°
    expect(legacy.inFrame).toBe(true);
    const [vertical] = projectScene({ ...base, aspect: '9:16' }); // 半视角 16.1°
    expect(vertical.inFrame).toBe(false);
    const issues = auditStaging({ ...base, aspect: '9:16' });
    expect(issues.some((i) => i.kind === 'off-frame' && i.actorId === 'a')).toBe(true);
    // 并且与真实相机一致:ndc.x 超出 ±1
    const cam = threeCamera({ ...base, aspect: '9:16' });
    expect(Math.abs(ndc(cam, base.actors[0].x, 1.6, base.actors[0].z).x)).toBeGreaterThan(1);
  });

  it('景别按画幅高度算:同距离同焦距,9:16(高 36mm)比 3:2(高 24mm)更松', () => {
    const order = ['ECU', 'CU', 'MS', 'LS', 'WS', 'ELS'];
    const legacy = inferShotSize(4, '35', 1.7);
    const vertical = inferShotSize(4, '35', 1.7, '9:16');
    expect(order.indexOf(vertical)).toBeGreaterThanOrEqual(order.indexOf(legacy));
    expect(inferShotSize(4, '35', 1.7, undefined)).toBe(legacy); // 缺省与修前一致
  });
});

describe('v12.439 · 向后兼容:不带画幅的旧舞台,输出只在「角度线性 → 直线透视」上变化', () => {
  it('画面正中与边缘两个点与修前完全一致', () => {
    const half = horizontalFovDeg('35') / 2;
    const center = projectScene({ camera: { x: 0, z: 0, yawDeg: 0, lens: '35' }, actors: [{ id: 'c', x: 0, z: 5 }] })[0];
    expect(center.screenX).toBeCloseTo(0, 6);
    const edge = projectScene({ camera: { x: 0, z: 0, yawDeg: 0, lens: '35' }, actors: [{ id: 'e', x: 5 * Math.tan(rad(half)), z: 5 }] })[0];
    expect(edge.screenX).toBeCloseTo(1, 4);
  });
});
