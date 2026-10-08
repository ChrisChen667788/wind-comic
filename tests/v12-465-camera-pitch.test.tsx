/**
 * v12.465 · 舞台相机能低头 / 抬头了(俯仰)。
 *
 * 修前舞台相机只有朝向(绕竖轴转)和高度:所谓「高机位」只是把相机抬高、镜头仍然水平。
 * 提示词却按机高写成 high-angle looking down,中文描述写「高角度俯拍」—— 3D 预览和草图里看到的是平视画面,
 * 机高 3 米以上配长焦时人整个落到画框下方之外(v12.462 走查撞到)。三处说的不是同一台相机。
 *
 * 现在 `camera.pitchDeg`(负 = 低头)贯穿几何、提示词、中文描述、体检、草图、2D 预览、3D 相机与视锥:
 *   - 投影直接对照 three.js PerspectiveCamera,且相机朝向取 3D 视口**真正用的** `cameraEuler`(YXZ),不另写一套;
 *   - 没设俯仰 / 俯仰为 0 时,每一个数值与修前逐位相同(旧舞台不变);
 *   - 机位角改按**实际朝向**说:镜头水平就说「高 / 低机位平视」,只有真的低头才说俯拍。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  projectScene, auditStaging, stageDirectiveForShot, describeStaging, sensorDims, verticalFovDeg,
  cameraViewOf, horizonScreenY, aimPitchDeg, validateStagePayload, POSE_PRESETS,
  type StageScene,
} from '@/lib/stage-blocking';
import { renderStageSketch, sketchMetaFromScene } from '@/lib/stage-sketch';
import { cameraEuler, frustumSegments } from '@/components/project/stage3d-viewport';
import { DirectorStageModal } from '@/components/project/director-stage-modal';
import type { LensId } from '@/lib/cinematography';

afterEach(() => { cleanup(); });

const rad = (d: number) => (d * Math.PI) / 180;
const A = (id: string, name: string, x = 0, z = 5) => ({ id, name, x, z });

/** 3D 视口里那台相机:位置 + `cameraEuler`(与 <PerspectiveCamera rotation={cameraEuler(cam)}> 同一组值) */
function lensCamera(scene: StageScene): THREE.PerspectiveCamera {
  const c = scene.camera;
  const { sW, sH } = sensorDims(scene.aspect);
  const cam = new THREE.PerspectiveCamera(verticalFovDeg(c.lens, scene.aspect), sW / sH, 0.01, 1000);
  cam.position.set(c.x, c.heightM ?? 1.6, -c.z);
  const [x, y, z, order] = cameraEuler(c);
  cam.rotation.set(x, y, z, order);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
const ndc = (cam: THREE.PerspectiveCamera, x: number, y: number, z: number) => new THREE.Vector3(x, y, -z).project(cam);

describe('v12.465 · 投影与 three.js 真相机一致(带俯仰)', () => {
  it('画幅 × 焦距 × 朝向 × 俯仰 × 机高 × 位置:screenTop / screenBottom 与 three 投影一致,screenX 取身体中段', () => {
    let n = 0;
    for (const aspect of ['16:9', '9:16', undefined]) {
      for (const lens of ['18', '35', '85'] as LensId[]) {
        for (const yawDeg of [0, 33, -140]) {
          for (const pitchDeg of [-60, -25, -6, 0, 12, 40]) {
            for (const heightM of [0.4, 1.6, 3.5]) {
              for (const [fwd, side] of [[4, 0], [7, 1.2], [3, -0.6]]) {
                const cx = 0.3, cz = -1;
                const x = cx + side * Math.cos(rad(yawDeg)) + fwd * Math.sin(rad(yawDeg));
                const z = cz - side * Math.sin(rad(yawDeg)) + fwd * Math.cos(rad(yawDeg));
                const scene: StageScene = { aspect, camera: { x: cx, z: cz, yawDeg, lens, heightM, pitchDeg }, actors: [{ id: 'a', x, z, heightM: 1.7 }] };
                const cam = lensCamera(scene);
                const foot = ndc(cam, x, 0, z), head = ndc(cam, x, 1.7, z), mid = ndc(cam, x, 0.85, z);
                const p = projectScene(scene)[0];
                // 只比相机前方的点(背后的点 three 的 NDC 会翻号,几何层按 1e-6 夹住,本就不同)
                const before = (yy: number) => new THREE.Vector3(x, yy, -z).applyMatrix4(cam.matrixWorldInverse).z < -1e-3;
                if (before(0)) expect(p.screenBottom, `${aspect} ${lens} yaw${yawDeg} p${pitchDeg} h${heightM} f${fwd}`).toBeCloseTo(foot.y, 4);
                if (before(1.7)) expect(p.screenTop).toBeCloseTo(head.y, 4);   // 几何层输出保留 4 位小数
                if (before(0.85)) expect(p.screenX).toBeCloseTo(mid.x, 4);
                n++;
              }
            }
          }
        }
      }
    }
    expect(n).toBe(3 * 3 * 3 * 6 * 3 * 3);
  });

  it('**没设俯仰 = 俯仰 0 = 修前**:投影、体检、提示词、描述逐值相同(旧舞台不变)', () => {
    const base: StageScene = { aspect: '9:16', camera: { x: 0.5, z: -1, yawDeg: -5, lens: '50', heightM: 2.4 }, actors: [A('a', '林晚', 0, 5), A('b', '陆沉', 0.6, 8)] };
    const zero = { ...base, camera: { ...base.camera, pitchDeg: 0 } };
    expect(projectScene(zero)).toEqual(projectScene(base));
    expect(auditStaging(zero)).toEqual(auditStaging(base));
    expect(stageDirectiveForShot(zero)).toBe(stageDirectiveForShot(base));
    expect(describeStaging(zero)).toBe(describeStaging(base));
    expect(horizonScreenY(base)).toBe(-0);
  });

  it('3D 相机欧拉角:没设俯仰时与修前「只绕 Y 转 −yaw」相同;必须是 YXZ(先低头再转向)', () => {
    expect(cameraEuler({ x: 0, z: 0, yawDeg: 30, lens: '35' })).toEqual([0, -rad(30), 0, 'YXZ']);
    // 反例自证:用 three 默认的 XYZ,yaw ≠ 0 时镜头会绕世界 X 轴歪成荷兰角 —— 画面上的地平线不再水平
    const scene: StageScene = { aspect: '16:9', camera: { x: 0, z: 0, yawDeg: 60, lens: '35', heightM: 1.6, pitchDeg: -30 }, actors: [] };
    const right = lensCamera(scene);
    const wrong = lensCamera(scene); wrong.rotation.order = 'XYZ'; wrong.updateMatrixWorld();
    const roll = (cam: THREE.PerspectiveCamera) => new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).y;
    expect(Math.abs(roll(right)), 'YXZ:相机的「右」保持水平').toBeLessThan(1e-9);
    expect(Math.abs(roll(wrong)), 'XYZ:相机的「右」翘起来了').toBeGreaterThan(0.3);
  });

  it('视锥四角经 three 相机投影恰在画面四角(带俯仰;含广角竖幅 + 大俯角 —— 下沿越过铅垂线往后指是对的)', () => {
    // 18mm 9:16 竖向半视角 45°:俯仰 −50° 时视锥下沿已越过正下方、朝机位身后斜(世界 z 往回走)——
    // 这是真实相机在这个角度看得到的范围,不是「角点跑到相机背后」:在相机自身坐标里四角恒在前方,投影仍落在画面四角
    for (const [aspect, lens] of [['9:16', '24'], ['16:9', '24'], ['9:16', '18']] as const) {
      for (const pitchDeg of [-80, -50, -15, 20]) {
        for (const yawDeg of [0, 37, -120]) {
          const scene: StageScene = { aspect, camera: { x: 1, z: -0.5, yawDeg, lens, heightM: 2.2, pitchDeg }, actors: [] };
          const cam = lensCamera(scene);
          const segs = frustumSegments(scene);
          const inFront = [1, 3, 5, 7].map((k) => new THREE.Vector3(...segs[k]).applyMatrix4(cam.matrixWorldInverse).z);
          for (const z of inFront) expect(z, `${aspect} ${lens}mm p${pitchDeg}:相机坐标里角点在前方`).toBeLessThan(0);
          const corners = [1, 3, 5, 7].map((k) => new THREE.Vector3(...segs[k]).project(cam));
          const want = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
          corners.forEach((c, k) => {
            expect(c.x, `${aspect} ${lens}mm p${pitchDeg} yaw${yawDeg} #${k}`).toBeCloseTo(want[k][0], 6);
            expect(c.y, `${aspect} ${lens}mm p${pitchDeg} yaw${yawDeg} #${k}`).toBeCloseTo(want[k][1], 6);
          });
        }
      }
    }
  });

  it('地平线位置:与 three 投影远处一点(机高处)一致;低头时上移,抬头时下移', () => {
    for (const pitchDeg of [-20, -5, 0, 10]) {
      const scene: StageScene = { aspect: '9:16', camera: { x: 0, z: 0, yawDeg: 25, lens: '35', heightM: 2, pitchDeg }, actors: [] };
      const cam = lensCamera(scene);
      const far = ndc(cam, Math.sin(rad(25)) * 1e5, 2, Math.cos(rad(25)) * 1e5);
      expect(horizonScreenY(scene), `p${pitchDeg}`).toBeCloseTo(far.y, 4);
    }
    const tilt = (pitchDeg: number): StageScene => ({ aspect: '16:9', camera: { x: 0, z: 0, yawDeg: 0, lens: '35', pitchDeg }, actors: [] });
    expect(horizonScreenY(tilt(-20))).toBeGreaterThan(0);
    expect(horizonScreenY(tilt(15))).toBeLessThan(0);
  });
});

describe('v12.465 · 机位角按实际朝向说', () => {
  it('cameraViewOf:俯仰决定俯 / 仰 / 顶视;镜头水平时按机高说「高 / 低机位平视」', () => {
    expect(cameraViewOf({ heightM: 3 }).cn).toBe('高机位平视');
    expect(cameraViewOf({ heightM: 3 }).en).toBe('camera raised above eye level, lens kept level');
    expect(cameraViewOf({ heightM: 0.5 }).cn).toBe('低机位平视');
    expect(cameraViewOf({ heightM: 1.6 })).toEqual({ angle: 'eye', tiltDeg: 0, en: '', cn: '平视机位' });
    expect(cameraViewOf({ heightM: 3, pitchDeg: -20 }).angle).toBe('high');
    expect(cameraViewOf({ heightM: 0.5, pitchDeg: 20 }).angle).toBe('low');
    expect(cameraViewOf({ heightM: 4, pitchDeg: -75 }).angle).toBe('overhead');
    expect(cameraViewOf({ heightM: 1.6, pitchDeg: -7 }).angle, '几度的微调仍算平视').toBe('eye');
  });

  it('草图元数据的机位角与提示词同一判据(草图锁那句「camera angle」不再与画面矛盾)', () => {
    const level: StageScene = { aspect: '16:9', camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 3 }, actors: [A('a', '林晚', 0, 9)] };
    expect(sketchMetaFromScene(level).angle).toBe('eye');
    expect(sketchMetaFromScene({ ...level, camera: { ...level.camera, pitchDeg: -20 } }).angle).toBe('high');
  });
});

describe('v12.465 · 「对准人物」把出画的人拉回画面', () => {
  // v12.462 走查撞到的那一镜:9:16、85mm、机高 3.2 米、平视 —— 两人都整个在画框下方之外
  const high: StageScene = {
    aspect: '9:16', camera: { x: 0, z: 0, yawDeg: 10, lens: '85', heightM: 3.2 },
    actors: [A('a', '林晚', 1, 5), A('b', '陆沉', 1.7, 6.22)],
  };

  it('窗口自证:平视时都在画外,体检建议压俯仰 / 点「对准人物」', () => {
    expect(projectScene(high).every((p) => !p.inFrame)).toBe(true);
    const msgs = auditStaging(high).map((i) => i.message).join('\n');
    expect(msgs).toContain('林晚 整个在画面下方之外');
    expect(msgs).toContain('对准人物');
  });

  it('**对准后两人都回到画内,提示词写俯拍,且俯拍不是凭空写的(画面确实在往下看)**', () => {
    const pitchDeg = aimPitchDeg(high);
    expect(pitchDeg).toBeLessThan(-8);
    const aimed = { ...high, camera: { ...high.camera, pitchDeg } };
    expect(projectScene(aimed).every((p) => p.inFrame)).toBe(true);
    expect(stageDirectiveForShot(aimed)).toMatch(/^\. Staging: high-angle camera looking down; 林晚 /);
    expect(horizonScreenY(aimed), '低头 → 地平线在画面上半部(或更高)').toBeGreaterThan(0);
  });

  it('没人 → 保持平视;人都在机位背后 → 也不乱转', () => {
    expect(aimPitchDeg({ ...high, actors: [] })).toBe(0);
    expect(aimPitchDeg({ ...high, actors: [A('a', '林晚', 0, -5)] })).toBe(0);
  });

  it('机位贴地、人在近处 → 往上抬', () => {
    const low: StageScene = { aspect: '16:9', camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 0.2 }, actors: [A('a', '林晚', 0, 2)] };
    expect(aimPitchDeg(low)).toBeGreaterThan(8);
  });
});

describe('v12.465 · 保存校验', () => {
  const isPose = (v: unknown) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(POSE_PRESETS, v);
  const CAM = { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 };
  const ok = (pitchDeg: unknown) => validateStagePayload({ camera: { ...CAM, pitchDeg }, actors: [A('a', '林晚')] }, isPose);

  it('−89°–89° 之间放行;越界 / 非数字 → 400;null 视同清除', () => {
    for (const v of [-80, -12.5, 0, 60]) expect(ok(v).ok, String(v)).toBe(true);
    for (const v of [90, -95, 'down', Number.NaN]) {
      const r = ok(v);
      expect(r.ok, String(v)).toBe(false);
      if (!r.ok) expect(r.error).toContain('俯仰');
    }
    const r = ok(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect('pitchDeg' in r.scene.camera).toBe(false);
  });
});

describe('v12.465 · 布局草图里的地平线跟着俯仰走', () => {
  function horizonRows(png: Buffer, W: number, H: number): number[] {
    let off = 8; const idat: Buffer[] = [];
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      if (png.subarray(off + 4, off + 8).toString('ascii') === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const rows: number[] = [];
    for (let y = 0; y < H; y++) {
      // 地平线是 170 灰的整行(三分线是 200 灰)
      let hits = 0;
      for (let x = 0; x < W; x += 8) { const i = y * (W * 3 + 1) + 1 + x * 3; if (raw[i] === 170 && raw[i + 1] === 170) hits++; }
      if (hits > (W / 8) * 0.9) rows.push(y);
    }
    return rows;
  }
  const scene = (pitchDeg?: number): StageScene => ({ aspect: '16:9', camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6, pitchDeg }, actors: [] });

  it('平视在正中(修前行为);低头 15° 上移到 horizonScreenY 所说的那一行;低头 60° 出了画面就不画', () => {
    expect(horizonRows(renderStageSketch(scene(), { width: 320, height: 180 }), 320, 180)).toEqual([90]);
    const hy = horizonScreenY(scene(-15));
    expect(horizonRows(renderStageSketch(scene(-15), { width: 320, height: 180 }), 320, 180)).toEqual([Math.round(((1 - hy) / 2) * 180)]);
    expect(Math.round(((1 - hy) / 2) * 180)).toBeLessThan(60);
    expect(horizonRows(renderStageSketch(scene(-60), { width: 320, height: 180 }), 320, 180)).toEqual([]);
  });
});

describe('v12.465 · 弹窗:俯仰滑杆与「对准人物」', () => {
  vi.setConfig({ testTimeout: 30_000 });
  const open = () => render(
    <DirectorStageModal projectId="p1" shotNumber={1} onClose={() => {}} aspect="9:16"
      initialScene={{ camera: { x: 0, z: 0, yawDeg: 10, lens: '85', heightM: 3.2 }, actors: [A('a', '林晚', 1, 5), A('b', '陆沉', 1.7, 6.22)] }} />,
  );
  const directive = () => document.querySelector('details code')?.textContent ?? '';

  it('**抬高的机位如实显示「高机位平视」;点「对准人物」→ 俯仰压下、人回到画里、提示词写俯拍**', () => {
    open();
    expect(document.querySelector('[data-camera-view]')?.textContent).toBe('高机位平视');
    expect(directive(), '平视时两人都在画外,站位句为空').toBe('');
    fireEvent.click(screen.getByRole('button', { name: '对准人物' }));
    const slider = screen.getByLabelText('俯仰') as HTMLInputElement;
    expect(Number(slider.value)).toBeLessThan(-8);
    expect(document.querySelector('[data-camera-view]')?.textContent).toBe('高角度俯拍机位');
    expect(directive()).toContain('high-angle camera looking down');
    expect(directive()).toContain('林晚');
  });

  it('拖俯仰滑杆:2D 预览里的地平线跟着移,出画就消失', () => {
    open();
    const line = () => document.querySelector('line[data-horizon]');
    const mid = Number(line()!.getAttribute('y1'));
    expect(mid, '平视:正中').toBeCloseTo(Number(line()!.closest('svg')!.getAttribute('viewBox')!.split(' ')[3]) / 2, 6);
    fireEvent.change(screen.getByLabelText('俯仰'), { target: { value: '-10' } });
    expect(Number(line()!.getAttribute('y1'))).toBeLessThan(mid);
    fireEvent.change(screen.getByLabelText('俯仰'), { target: { value: '-70' } });
    expect(line()).toBeNull();
    expect(document.querySelector('[data-camera-view]')?.textContent).toBe('顶视机位');
  });
});
