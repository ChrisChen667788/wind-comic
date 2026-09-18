/**
 * v12.440 —— 人物朝向进几何:正面 / 3/4 侧 / 侧面 / 3/4 背 / 背面、朝画面哪边、望向谁。
 *
 * `StageActor.facingDeg` 从 v12.316 起就在类型里,但**全仓没有一处读它** ——
 * 导演台既不画朝向,提示词也不说谁朝哪。v12.439 发版时为了不误导,3D 人偶刻意不画朝向。
 *
 * 这里锁三件事:
 *   ① 旧数据(没设朝向)的描述与提示词**逐字不变** —— 期望字符串取自 v12.439 的代码,不是本版算出来的;
 *   ② 左右判定与 three.js 真实投影一致 —— 画面边上的人,「机位右方向」与「视线右法向」会给出相反答案;
 *   ③ 「望向谁」只在对方也在画内时进提示词。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u1' })) }));
vi.mock('@/lib/repos/project-repo', () => ({ getProject: vi.fn(async () => ({ id: 'p1', aspect: '16:9' })) }));
const stored: { rows: any[] } = { rows: [] };
vi.mock('@/lib/repos/asset-repo', () => ({
  listAssetsByType: vi.fn(async () => stored.rows),
  createAsset: vi.fn(async () => ({ id: 'x' })),
}));
import * as THREE from 'three';
import {
  facingOf, projectScene, stageDirectiveForShot, describeStaging, auditStaging,
  sensorDims, verticalFovDeg, TOWARD_TOLERANCE_DEG,
  type StageScene, type StageCamera, type StageActor,
} from '@/lib/stage-blocking';

const CAM: StageCamera = { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 };
const at = (facingDeg: number | undefined, x = 0, z = 5): StageActor => ({ id: 'a', name: '林晚', x, z, facingDeg });

describe('v12.440 · 旧数据逐字不变(期望值取自 v12.439 代码)', () => {
  const LEGACY: { scene: StageScene; d: string; c: string }[] = [
    {
      scene: { camera: CAM, actors: [{ id: 'a', name: '林晚', x: -1, z: 4 }, { id: 'b', name: '陆沉', x: 1.2, z: 6 }], aspect: '16:9' },
      d: '. Staging: 林晚 left of center in full shot; 陆沉 right of center in full shot',
      c: '平视机位,54° 水平视角;林晚位于中偏左(全景,距机位约 4.1 米);陆沉位于中偏右(全景,距机位约 6.1 米)。',
    },
    {
      scene: { camera: { x: 0.5, z: -1, yawDeg: -5, lens: '50', heightM: 0.8 }, actors: [{ id: 'a', name: '沈青梧', x: 0, z: 5 }, { id: 'b', x: 0.1, z: 8 }], aspect: '9:16' },
      d: '. Staging: 沈青梧 at frame center in wide shot; b right of center in wide shot, partially occluded by 沈青梧',
      c: '低角度仰拍机位,23° 水平视角;沈青梧位于画面中央(远景,距机位约 6.0 米);b位于中偏右(远景,距机位约 9.0 米,被沈青梧部分遮挡)。',
    },
  ];

  it('提示词与中文描述与 v12.439 完全相同', () => {
    for (const l of LEGACY) {
      expect(stageDirectiveForShot(l.scene)).toBe(l.d);
      expect(describeStaging(l.scene)).toBe(l.c);
    }
  });

  it('投影结果不带 facing 键;体检不多报', () => {
    for (const l of LEGACY) {
      for (const p of projectScene(l.scene)) expect('facing' in p).toBe(false);
      expect(auditStaging(l.scene).some((i) => i.kind === 'no-face-to-camera')).toBe(false);
    }
  });

  it('脏值当未设:NaN / Infinity / 字符串 "90"', () => {
    expect(facingOf(at(NaN), CAM)).toBeNull();
    expect(facingOf(at(Infinity), CAM)).toBeNull();
    expect(facingOf({ ...at(undefined), facingDeg: '90' as any }, CAM)).toBeNull();
  });
});

describe('v12.440 · 正侧背分档(机位在原点朝 +z,人在正前方 5 米)', () => {
  const table: [number, string, string | undefined][] = [
    [180, 'front', undefined],          // 面朝 −z = 正对镜头
    [0, 'back', undefined],
    [90, 'profile', 'right'],
    [-90, 'profile', 'left'],
    [135, 'three-quarter', 'right'],    // 与「人→机位」差 45°
    [-135, 'three-quarter', 'left'],
    [45, 'three-quarter-back', 'right'],
    [-45, 'three-quarter-back', 'left'],
    [150, 'front', undefined],          // 恰 30° 边界算正面
    [149, 'three-quarter', 'right'],
    [450, 'profile', 'right'],          // 超出 ±180 先归一化
  ];
  it.each(table)('facingDeg=%s → %s / %s', (deg, view, side) => {
    const f = facingOf(at(deg), CAM)!;
    expect(f.view).toBe(view);
    expect(f.screenSide).toBe(side);
  });

  it('参照是「人→机位」不是光轴:画面右边上的人朝 −z,镜头看到的是 3/4 侧而非正面', () => {
    const f = facingOf(at(180, 3, 5), CAM)!;
    expect(f.offCameraDeg).toBeCloseTo(31, 0);
    expect(f.view).toBe('three-quarter');
    // 真正正对镜头要朝向「人→机位」方位角
    const toCam = (Math.atan2(-3, -5) * 180) / Math.PI;
    expect(facingOf(at(toCam, 3, 5), CAM)!.view).toBe('front');
  });
});

describe('v12.440 · 左右与 three.js 真实投影一致', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  function ndcX(scene: StageScene, x: number, y: number, z: number) {
    const c = scene.camera;
    const { sW, sH } = sensorDims(scene.aspect);
    const cam = new THREE.PerspectiveCamera(verticalFovDeg(c.lens, scene.aspect), sW / sH, 0.01, 1000);
    cam.position.set(c.x, c.heightM ?? 1.6, -c.z);
    cam.rotation.set(0, -rad(c.yawDeg), 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return new THREE.Vector3(x, y, -z).project(cam).x;
  }

  it('鼻尖朝向往画面哪边偏,screenSide 就说哪边(各机位朝向 × 画面各处 × 各朝向)', () => {
    let checked = 0;
    let lensAxisWouldFail = 0;
    for (const yawDeg of [0, 30, -65, 150]) {
      for (const lateral of [-4, -2.2, -1, 0, 1, 2.2, 4]) {
        for (let facing = -180; facing < 180; facing += 15) {
          const camera: StageCamera = { x: 0.3, z: -0.4, yawDeg, lens: '18', heightM: 1.5 };
          const fwd = 5;
          const ax = camera.x + lateral * Math.cos(rad(yawDeg)) + fwd * Math.sin(rad(yawDeg));
          const az = camera.z - lateral * Math.sin(rad(yawDeg)) + fwd * Math.cos(rad(yawDeg));
          const scene: StageScene = { camera, actors: [{ id: 'a', x: ax, z: az, facingDeg: facing }], aspect: '16:9' };
          const f = facingOf(scene.actors[0], camera)!;
          if (!f.screenSide) continue;
          const eps = 0.02;
          const x0 = ndcX(scene, ax, 1.6, az);
          const x1 = ndcX(scene, ax + eps * Math.sin(rad(facing)), 1.6, az + eps * Math.cos(rad(facing)));
          if (Math.abs(x1 - x0) < 1e-7) continue;   // 恰沿视线方向,左右无定义
          expect(x1 > x0 ? 'right' : 'left', `yaw=${yawDeg} lateral=${lateral} facing=${facing}`).toBe(f.screenSide);
          // 同时统计:若按机位光轴右方向判,会错多少条(证明本版的算法选择不是随手的)。
          // 只有视线偏光轴超过 30°(18mm 画面边上 lateral=±4 → 38.7°)时两种算法才会分歧 ——
          // 偏得少时,分歧区间整个落在「正面/背面」档里,不判左右。
          const axisDot = Math.sin(rad(facing)) * Math.cos(rad(yawDeg)) - Math.cos(rad(facing)) * Math.sin(rad(yawDeg));
          if ((axisDot >= 0 ? 'right' : 'left') !== (x1 > x0 ? 'right' : 'left')) lensAxisWouldFail++;
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(lensAxisWouldFail, '光轴算法在画面边上会判反').toBeGreaterThan(0);
  });
});

describe('v12.440 · 望向谁', () => {
  const two = (fa: number | undefined, fb: number | undefined, bx = 1.5): StageScene => ({
    camera: CAM,
    actors: [
      { id: 'a', name: '林晚', x: -1.5, z: 5, facingDeg: fa },
      { id: 'b', name: '陆沉', x: bx, z: 5, facingDeg: fb },
    ],
    aspect: '16:9',
  });

  it('面对面:两人互相望向,提示词写出侧面朝向与对象', () => {
    const d = stageDirectiveForShot(two(90, -90));
    expect(d).toContain('林晚 at frame left in full shot, in profile, facing screen right toward 陆沉');
    expect(d).toContain('陆沉 at frame right in full shot, in profile, facing screen left toward 林晚');
    const c = describeStaging(two(90, -90));
    expect(c).toContain('侧身朝画面右,望向陆沉');
    expect(c).toContain('侧身朝画面左,望向林晚');
  });

  it(`容差 ±${TOWARD_TOLERANCE_DEG}°:偏 25° 仍算,偏 26° 不算`, () => {
    expect(facingOf(two(90 + 25, -90).actors[0], CAM, two(0, 0).actors)!.towardId).toBe('b');
    expect(facingOf(two(90 + 26, -90).actors[0], CAM, two(0, 0).actors)!.towardId).toBeUndefined();
  });

  it('对方在画外:几何层知道朝向谁,但提示词不说(免得把画外的人画进来)', () => {
    const scene = two(90, undefined, 9);   // 陆沉站到 x=9,35mm 16:9 下出画
    expect(projectScene(scene).find((p) => p.id === 'b')!.inFrame).toBe(false);
    expect(facingOf(scene.actors[0], CAM, scene.actors)!.towardId).toBe('b');
    const d = stageDirectiveForShot(scene);
    expect(d).toContain('in profile, facing screen right');
    expect(d).not.toContain('陆沉');
    expect(describeStaging(scene)).not.toContain('望向');
  });

  it('望向「最正对着的」而不是「最近的」;角度相同再比距离;仍相同按数组顺序(结果恒定)', () => {
    const base = { id: 'a', name: '林晚', x: 0, z: 5, facingDeg: 0 };
    const near20 = { id: 'b', name: '陆沉', x: 3 * Math.sin((20 * Math.PI) / 180), z: 5 + 3 * Math.cos((20 * Math.PI) / 180) };
    const far0 = { id: 'c', name: '沈青梧', x: 0, z: 11 };
    expect(facingOf(base, CAM, [base, near20, far0])!.towardId).toBe('c');
    expect(facingOf(base, CAM, [base, far0, near20])!.towardId, '与顺序无关').toBe('c');
    // 角度相同(都正前方)→ 近的
    const near0 = { id: 'd', name: '路人', x: 0, z: 8 };
    expect(facingOf(base, CAM, [base, far0, near0])!.towardId).toBe('d');
    // 左右对称、距离相同 → 按数组顺序,且多次运行结果一致
    const l = { id: 'l', x: -0.5, z: 8 }, r = { id: 'r', x: 0.5, z: 8 };
    expect(facingOf(base, CAM, [base, l, r])!.towardId).toBe('l');
    expect(facingOf(base, CAM, [base, r, l])!.towardId).toBe('r');
  });

  it('最正对着的人在画外、次之的在画内:望向画内那个(画外的不能挤掉他)', () => {
    const scene: StageScene = {
      camera: CAM, aspect: '16:9',
      actors: [
        { id: 'a', name: '林晚', x: 2.5, z: 5, facingDeg: 30 },
        { id: 'c', name: '路人', x: 3.03, z: 5.848 }, // 林晚正前方偏 2°(最正对着),但刚好出画(27.4° > 半视角 27.2°)
        { id: 'b', name: '陆沉', x: 3.5, z: 8 },       // 偏 11.6°、在画内
      ],
    };
    const byId = Object.fromEntries(projectScene(scene).map((p) => [p.id, p]));
    expect(byId.c.inFrame).toBe(false);
    expect(byId.b.inFrame).toBe(true);
    expect(facingOf(scene.actors[0], CAM, scene.actors)!.towardId, '前提:几何层按全体选,选中的是画外的路人').toBe('c');
    expect(byId.a.facing!.towardId).toBe('b');
    expect(stageDirectiveForShot(scene)).toMatch(/林晚 [^;]*with back to camera, facing 陆沉/);
  });

  it('只设一个人的朝向:另一个人的描述保持旧格式', () => {
    const d = stageDirectiveForShot(two(90, undefined));
    expect(d).toMatch(/陆沉 at frame right in full shot$/);
  });

  it('背对镜头望向纵深里的人(过肩镜头)', () => {
    const scene: StageScene = {
      camera: CAM,
      actors: [
        { id: 'a', name: '林晚', x: -0.4, z: 2.5, facingDeg: 0 },
        { id: 'b', name: '陆沉', x: 0.3, z: 6, facingDeg: 180 },
      ],
      aspect: '16:9',
    };
    const d = stageDirectiveForShot(scene);
    expect(d).toContain('林晚');
    expect(d).toMatch(/林晚 [^;]*with back to camera, facing 陆沉/);
    expect(d).toMatch(/陆沉 [^;]*facing camera, turned toward 林晚/);
  });
});

describe('v12.440 · 体检:画面里没有一张脸朝镜头', () => {
  const scene = (fa: number | undefined, fb: number | undefined): StageScene => ({
    camera: CAM,
    actors: [
      { id: 'a', name: '林晚', x: -1, z: 5, facingDeg: fa },
      { id: 'b', name: '陆沉', x: 1, z: 5, facingDeg: fb },
    ],
  });
  const has = (s: StageScene) => auditStaging(s).some((i) => i.kind === 'no-face-to-camera');

  it('两人都侧身/背身 → 报', () => {
    expect(has(scene(90, -90))).toBe(true);
    expect(has(scene(0, 10))).toBe(true);
  });
  it('有一人 3/4 侧或正面 → 不报', () => {
    expect(has(scene(90, -135))).toBe(false);
    expect(has(scene(90, 180))).toBe(false);
  });
  it('有人没设朝向 → 不替他下结论,不报', () => {
    expect(has(scene(90, undefined))).toBe(false);
  });
});

describe('v12.440 · 3D 人偶朝向与几何同一约定', () => {
  it('mannequinYawRad:用 three 的 Euler 真转一遍,局部前方落在舞台朝向上', async () => {
    const { mannequinYawRad } = await import('@/components/project/stage3d-viewport');
    expect(mannequinYawRad(undefined)).toBeNull();
    expect(mannequinYawRad(NaN)).toBeNull();
    for (let f = -180; f <= 180; f += 30) {
      const v = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, mannequinYawRad(f)!, 0));
      const rad = (f * Math.PI) / 180;
      // 舞台 (sin f, cos f) → three (sin f, 0, −cos f)
      expect(v.x).toBeCloseTo(Math.sin(rad), 6);
      expect(v.z).toBeCloseTo(-Math.cos(rad), 6);
    }
  });

  it('面罩只在设了朝向时渲染(源码:条件是 yaw !== null)', () => {
    const viewportSrc = require('node:fs').readFileSync('components/project/stage3d-viewport.tsx', 'utf-8') as string;
    const i = viewportSrc.indexOf('{yaw !== null && (');
    expect(i).toBeGreaterThan(0);
    expect(viewportSrc.slice(i, i + 400)).toContain('boxGeometry');
  });
});

describe('v12.440 · 导演台俯视图:拖外圈转朝向', () => {
  // jsdom 没有 PointerEvent 构造器 —— 补一个,否则 clientX 传不进去
  if (typeof (globalThis as any).PointerEvent === 'undefined') {
    (globalThis as any).PointerEvent = class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: any = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
    };
  }

  const open = async (initialScene: StageScene) => {
    const { render, cleanup } = await import('@testing-library/react');
    cleanup();
    const React = (await import('react')).default;
    const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
    render(React.createElement(DirectorStageModal, {
      projectId: 'p1', shotNumber: 1, onClose: () => {}, aspect: '16:9', initialScene,
    }));
    const svg = document.querySelector('svg[viewBox="0 0 340 300"]') as SVGSVGElement;
    // 让客户端坐标 = 俯视图像素坐标(PW=340, PH=300)
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 340, height: 300, right: 340, bottom: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return svg;
  };

  it('拖外圈到人物右边 → 朝向 90°,描述变「侧身朝画面右」,出现箭头;双击外圈清除', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const svg = await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    expect(document.querySelector('[data-facing-arrow="a"]'), '没设朝向不画箭头').toBeNull();
    expect(document.body.textContent).not.toContain('侧身');

    // 人物像素位置:x = (0+6)/12*340 = 170,y = 300 − (5+2)/14*300 = 150
    fireEvent.pointerDown(document.querySelector('[data-facing-handle="a"]')!, { clientX: 185, clientY: 150 });
    fireEvent.pointerMove(svg, { clientX: 240, clientY: 150 });
    fireEvent.pointerUp(svg);
    expect(document.body.textContent).toContain('侧身朝画面右');
    expect(document.querySelector('[data-facing-arrow="a"]')).toBeTruthy();

    // 拖到人物正下方(朝机位)→ 正面
    fireEvent.pointerDown(document.querySelector('[data-facing-handle="a"]')!, { clientX: 170, clientY: 165 });
    fireEvent.pointerMove(svg, { clientX: 171, clientY: 230 });
    fireEvent.pointerUp(svg);
    expect(document.body.textContent).toContain('正面朝镜头');

    fireEvent.doubleClick(document.querySelector('[data-facing-handle="a"]')!);
    expect(document.body.textContent).not.toContain('正面朝镜头');
    expect(document.querySelector('[data-facing-arrow="a"]')).toBeNull();
  });

  it('拖外圈不会把人拖走(事件不冒泡成「拖人物」)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const svg = await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    fireEvent.pointerDown(document.querySelector('[data-facing-handle="a"]')!, { clientX: 185, clientY: 150 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 60 });
    const dot = [...document.querySelectorAll('[data-actor="a"] circle')].find((c) => c.getAttribute('r') === '9')!;
    expect(dot.getAttribute('cx')).toBe('170');
    expect(dot.getAttribute('cy')).toBe('150');
  });

  it('视野扇形与几何判定一致:扇形内的人一定是金色、扇形外一定是红色(修前按像素算角度,边上会对不上)', async () => {
    const camera: StageCamera = { x: 0, z: 0, yawDeg: 20, lens: '24', heightM: 1.6 };
    // 24mm 16:9 半视角约 36.9°,在边线两侧 ±1.5° 各摆人
    const half = (Math.atan(18 / 24) * 180) / Math.PI;
    const actors: StageActor[] = [];
    [-1, 1].forEach((side) => [-1.5, 1.5].forEach((d, k) => {
      const b = ((camera.yawDeg + side * (half + d)) * Math.PI) / 180;
      actors.push({ id: `s${side}${k}`, x: 6 * Math.sin(b) * 0.9, z: 6 * Math.cos(b) * 0.9 + 1e-3 });
    }));
    await open({ camera, actors, aspect: '16:9' });
    const poly = document.querySelector('svg[viewBox="0 0 340 300"] polygon')!.getAttribute('points')!
      .trim().split(/\s+/).map((pt) => pt.split(',').map(Number));
    const inTri = ([px, py]: number[]) => {
      const [a, b, c] = poly;
      const s = (p1: number[], p2: number[]) => (px - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (py - p2[1]);
      const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    let checked = 0;
    for (const a of actors) {
      const dot = [...document.querySelectorAll(`[data-actor="${a.id}"] circle`)].find((c) => c.getAttribute('r') === '9')!;
      const gold = dot.getAttribute('fill')!.startsWith('rgba(245');
      expect(inTri([Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]), `${a.id} 扇形内外与颜色一致`).toBe(gold);
      checked++;
    }
    expect(checked).toBe(4);
  });
});

describe('v12.440 · 朝向一路走到提示词(路由与编排器读的是同一份)', () => {
  const actors = [
    { id: 'a', name: '林晚', x: -1.5, z: 5, facingDeg: 90 },
    { id: 'b', name: '陆沉', x: 1.5, z: 5, facingDeg: -90 },
  ];

  it('POST /stage dryRun:体检与提示词带朝向', async () => {
    const { POST } = await import('@/app/api/projects/[id]/stage/route');
    const res = await POST(new Request('http://t/api/projects/p1/stage', {
      method: 'POST', body: JSON.stringify({ shotNumber: 1, dryRun: true, camera: CAM, actors }),
    }) as any, { params: Promise.resolve({ id: 'p1' }) });
    const b = await res.json();
    expect(b.directive).toContain('in profile, facing screen right toward 陆沉');
    expect(b.description).toContain('侧身朝画面左,望向林晚');
    expect(b.issues.map((i: any) => i.kind)).toContain('no-face-to-camera');
  });

  it('getStageScene(编排器注入口)读回的舞台保留 facingDeg', async () => {
    stored.rows = [{ id: 's', shot_number: 2, data: JSON.stringify({ camera: CAM, actors }) }];
    const { getStageScene } = await import('@/lib/stage-scene-store');
    const scene = await getStageScene('p1', 2);
    expect(stageDirectiveForShot(scene)).toContain('in profile, facing screen left toward 林晚');
  });
});

describe('v12.440 · facingFromPoint', () => {
  it('四个方向 + 吸附 + 边界', async () => {
    const { facingFromPoint } = await import('@/lib/stage-blocking');
    const a = { x: 1, z: 2 };
    expect(facingFromPoint(a, 1, 5)).toBe(0);
    expect(facingFromPoint(a, 4, 2)).toBe(90);
    expect(facingFromPoint(a, -2, 2)).toBe(-90);
    expect(facingFromPoint(a, 1, -1), '−180 统一成 180').toBe(180);
    expect(facingFromPoint(a, 1 - 1e-6, -1), '从左后方逼近吸附到 −180,也要统一成 180').toBe(180);
    expect(facingFromPoint(a, 1 + Math.sin(Math.PI / 180 * 47), 2 + Math.cos(Math.PI / 180 * 47))).toBe(45);
    expect(facingFromPoint(a, 1.05, 2.05), '太近 → 无定义').toBeNull();
  });
});

describe('v12.440 审查补 · 3/4 侧身带望向对象时不丢画面方向', () => {
  it('英文与中文都带左右;无对象时保持原句', async () => {
    const { facingPhraseEn } = await import('@/lib/stage-blocking');
    const ids = new Set(['b']);
    const f = { view: 'three-quarter' as const, screenSide: 'right' as const, towardId: 'b', towardName: '陆沉', offCameraDeg: 45 };
    expect(facingPhraseEn(f, ids)).toBe('in three-quarter view, turned screen right toward 陆沉');
    expect(facingPhraseEn({ ...f, towardId: undefined, towardName: undefined }, ids)).toBe('in three-quarter view, turned toward screen right');
    // 走一遍真实场景:林晚 115° 望向陆沉
    const scene: StageScene = {
      camera: CAM, aspect: '16:9',
      actors: [{ id: 'a', name: '林晚', x: -1.5, z: 5, facingDeg: 115 }, { id: 'b', name: '陆沉', x: 1.5, z: 5 }],
    };
    expect(stageDirectiveForShot(scene)).toContain('林晚 at frame left in full shot, in three-quarter view, turned screen right toward 陆沉');
    expect(describeStaging(scene)).toContain('3/4 侧身朝画面右,望向陆沉');
  });
});

describe('v12.440 审查补 · POST /stage 校验人物数值字段', () => {
  const post = async (actors: unknown[], dryRun = true) => {
    const { POST } = await import('@/app/api/projects/[id]/stage/route');
    const res = await POST(new Request('http://t/api/projects/p1/stage', {
      method: 'POST', body: JSON.stringify({ shotNumber: 1, dryRun, camera: CAM, actors }),
    }) as any, { params: Promise.resolve({ id: 'p1' }) });
    return { status: res.status, body: await res.json() };
  };

  it('facingDeg 为字符串 → 400,并说清是哪个人、收到什么', async () => {
    const r = await post([{ id: 'a', x: 0, z: 5, facingDeg: '90' }]);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('第 1 个人物');
    expect(r.body.error).toContain('"90"');
  });

  it('x / z 缺失或非数字 → 400', async () => {
    expect((await post([{ id: 'a', z: 5 }])).status).toBe(400);
    expect((await post([{ id: 'a', x: 'left', z: 5 }])).status).toBe(400);
  });

  it('facingDeg 为 null 视同清除:落库的舞台里没有这个键', async () => {
    const { createAsset } = await import('@/lib/repos/asset-repo');
    (createAsset as any).mockClear();
    stored.rows = [];
    const r = await post([{ id: 'a', name: '林晚', x: 0, z: 5, facingDeg: null }], false);
    expect(r.status).toBe(200);
    const saved = (createAsset as any).mock.calls.at(-1)?.[0]?.data;
    expect(saved?.actors?.[0]).toBeTruthy();
    expect('facingDeg' in saved.actors[0]).toBe(false);
  });

  it('正常数值照常通过(正常侧)', async () => {
    const r = await post([{ id: 'a', name: '林晚', x: 0, z: 5, facingDeg: 90 }]);
    expect(r.status).toBe(200);
    expect(r.body.directive).toContain('in profile');
  });
});

describe('v12.440 审查补 · 俯视图键盘摆位与拖出边界', () => {
  const open = async (initialScene: StageScene) => {
    const { render, cleanup } = await import('@testing-library/react');
    cleanup();
    const React = (await import('react')).default;
    const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
    render(React.createElement(DirectorStageModal, { projectId: 'p1', shotNumber: 1, onClose: () => {}, aspect: '16:9', initialScene }));
    const svg = document.querySelector('svg[viewBox="0 0 340 300"]') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 340, height: 300, right: 340, bottom: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return svg;
  };
  const dot = (id: string) => [...document.querySelectorAll(`[data-actor="${id}"] circle`)].find((c) => c.getAttribute('r') === '9')!;

  it('人物可 Tab 聚焦(有可读的操作说明),聚焦时画出焦点圈', async () => {
    const { fireEvent } = await import('@testing-library/react');
    await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    const g = document.querySelector('[data-actor="a"]') as SVGGElement;
    expect(g.getAttribute('tabindex')).toBe('0');
    expect(g.getAttribute('aria-label')).toContain('林晚');
    expect(document.querySelector('[data-focus-ring="a"]')).toBeNull();
    fireEvent.focus(g);
    expect(document.querySelector('[data-focus-ring="a"]')).toBeTruthy();
    fireEvent.blur(g);
    expect(document.querySelector('[data-focus-ring="a"]')).toBeNull();
  });

  it('方向键移动人物(Shift 大步),↑ 是离机位更远', async () => {
    const { fireEvent } = await import('@testing-library/react');
    await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    const g = document.querySelector('[data-actor="a"]')!;
    fireEvent.keyDown(g, { key: 'ArrowRight' });
    expect(Number(dot('a').getAttribute('cx'))).toBeCloseTo(((0.1 + 6) / 12) * 340, 3);
    fireEvent.keyDown(g, { key: 'ArrowUp', shiftKey: true });
    expect(Number(dot('a').getAttribute('cy'))).toBeCloseTo(300 - ((5.5 + 2) / 14) * 300, 3);
    // 夹在片场范围内
    for (let i = 0; i < 40; i++) fireEvent.keyDown(g, { key: 'ArrowLeft', shiftKey: true });
    expect(Number(dot('a').getAttribute('cx'))).toBeCloseTo(0, 3);
  });

  it('Q / E 转朝向:未设时先设为朝向机位,之后每次 15°;Delete 清除', async () => {
    const { fireEvent } = await import('@testing-library/react');
    await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    const g = document.querySelector('[data-actor="a"]')!;
    fireEvent.keyDown(g, { key: 'e' });
    expect(document.body.textContent).toContain('正面朝镜头');
    for (let i = 0; i < 6; i++) fireEvent.keyDown(g, { key: 'E' });   // 180 + 90 → −90
    expect(document.body.textContent).toContain('侧身朝画面左');
    for (let i = 0; i < 12; i++) fireEvent.keyDown(g, { key: 'q' });  // −90 − 180 → 90
    expect(document.body.textContent).toContain('侧身朝画面右');
    fireEvent.keyDown(g, { key: 'Delete' });
    expect(document.body.textContent).not.toContain('侧身');
    expect(document.querySelector('[data-facing-arrow="a"]')).toBeNull();
  });

  it('Q / E 的精确角度:未设时正好朝向机位(180°),Q 逆时针 E 顺时针,存盘值归一到 (−180, 180]', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const bodies: any[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }) as any;
    try {
      await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
      const g = document.querySelector('[data-actor="a"]')!;
      const arrow = () => {
        const l = document.querySelector('[data-facing-arrow="a"]')!;
        return { dx: Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')), dy: Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')) };
      };
      fireEvent.keyDown(g, { key: 'e' });
      expect(arrow().dx, '未设时第一次按:正对机位,不偏').toBeCloseTo(0, 6);
      expect(arrow().dy, '机位在人物下方 → 箭头朝下').toBeGreaterThan(0);
      fireEvent.keyDown(g, { key: 'q' });   // 165° → sin > 0 → 箭头偏右
      expect(arrow().dx).toBeGreaterThan(0);
      fireEvent.keyDown(g, { key: 'e' });
      fireEvent.keyDown(g, { key: 'e' });   // 195° → 偏左
      expect(arrow().dx).toBeLessThan(0);
      for (let i = 0; i < 5; i++) fireEvent.keyDown(g, { key: 'e' });   // 195 + 75 = 270
      fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存站位'))!);
      await new Promise((r) => setTimeout(r, 0));
      expect(bodies.at(-1).actors[0].facingDeg, '270° 要存成 −90°,不让数值随按键无限增长').toBe(-90);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('机位也能用方向键移动', async () => {
    const { fireEvent } = await import('@testing-library/react');
    await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    const cam = document.querySelector('[data-camera]')!;
    const before = Number(cam.querySelector('circle[r="8"]')!.getAttribute('cy'));
    fireEvent.keyDown(cam, { key: 'ArrowUp' });
    expect(Number(cam.querySelector('circle[r="8"]')!.getAttribute('cy'))).toBeCloseTo(before - (0.1 / 14) * 300, 3);
  });

  it('拖朝向时移出俯视图:支持捕获就继续拖,不半路取消', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const svg = await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    const capture = vi.fn();
    (svg as any).setPointerCapture = capture;
    fireEvent.pointerDown(document.querySelector('[data-facing-handle="a"]')!, { pointerId: 7, clientX: 185, clientY: 150 });
    fireEvent.pointerLeave(svg, { pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 400, clientY: 150 });   // 俯视图右边界之外
    expect(document.body.textContent).toContain('侧身朝画面右');
  });

  it('多指触摸:另一根手指进出俯视图,既不被捕获、它的移动也不驱动拖动(第二轮审查补)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const svg = await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    const capture = vi.fn();
    (svg as any).setPointerCapture = capture;
    fireEvent.pointerDown(document.querySelector('[data-actor="a"]')!, { pointerId: 1, clientX: 170, clientY: 150 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 180, clientY: 150 });
    const cxAfterA = Number(dot('a').getAttribute('cx'));
    expect(cxAfterA).toBeCloseTo(180, 0);
    fireEvent.pointerLeave(svg, { pointerId: 2 });
    expect(capture, '别的手指离开不该被捕获').not.toHaveBeenCalled();
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 330, clientY: 40 });
    expect(Number(dot('a').getAttribute('cx')), '第二根手指的移动不能拖人').toBeCloseTo(cxAfterA, 3);
    fireEvent.pointerUp(svg, { pointerId: 2 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 150 });
    expect(Number(dot('a').getAttribute('cx')), '第二根手指抬起不结束第一根的拖动').toBeCloseTo(200, 0);
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 250, clientY: 150 });
    expect(Number(dot('a').getAttribute('cx')), '松手后不再跟随').toBeCloseTo(200, 0);
  });

  it('不支持捕获时移出即取消(修前行为),之后移动不再改朝向', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const svg = await open({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] });
    (svg as any).setPointerCapture = () => { throw new Error('InvalidPointerId'); };
    fireEvent.pointerDown(document.querySelector('[data-facing-handle="a"]')!, { pointerId: 7, clientX: 185, clientY: 150 });
    fireEvent.pointerLeave(svg, { pointerId: 7 });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 400, clientY: 150 });
    expect(document.body.textContent).not.toContain('侧身');
  });
});

describe('v12.440 · 所有出片路径都带导演台站位(修前只有整片生成读舞台)', () => {
  const FACING_ACTORS = [
    { id: 'a', name: '林晚', x: -1.5, z: 5, facingDeg: 90 },
    { id: 'b', name: '陆沉', x: 1.5, z: 5, facingDeg: -90 },
  ];
  const staged = () => { stored.rows = [{ id: 's', shot_number: 4, data: JSON.stringify({ camera: CAM, actors: FACING_ACTORS }) }]; };

  describe('注入口 withStageDirective', () => {
    it('摆过位 → 追加站位句;没摆过 / 没有项目 id → 原样', async () => {
      const { withStageDirective } = await import('@/lib/stage-scene-store');
      staged();
      const out = await withStageDirective('p1', 4, 'she turns away');
      expect(out.startsWith('she turns away. Staging: ')).toBe(true);
      expect(out).toContain('facing screen right toward 陆沉');
      expect(await withStageDirective('p1', 5, 'x'), '第 5 镜没摆过位').toBe('x');
      expect(await withStageDirective('', 4, 'x')).toBe('x');
      expect(await withStageDirective(undefined, 4, 'x')).toBe('x');
    });

    it('已经带站位句的提示词不重复追加', async () => {
      const { withStageDirective } = await import('@/lib/stage-scene-store');
      staged();
      const once = await withStageDirective('p1', 4, 'p');
      expect(await withStageDirective('p1', 4, once)).toBe(once);
    });

    it('读舞台抛错 → 原样返回,不打挂出片', async () => {
      const { withStageDirective } = await import('@/lib/stage-scene-store');
      const repo = await import('@/lib/repos/asset-repo');
      (repo.listAssetsByType as any).mockImplementationOnce(async () => { throw new Error('SQLITE_BUSY'); });
      expect(await withStageDirective('p1', 4, 'keep me')).toBe('keep me');
    });
  });

  describe('HybridOrchestrator.regenerateShot(单镜重生 / 自愈 / 剪辑师烤字重生共用)', () => {
    const run = async (opts: Record<string, unknown>, selfProjectId = '') => {
      const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
      const prompts: string[] = [];
      const fake: any = {
        projectId: selfProjectId,
        primaryCharacterRef: '',
        update: () => {},
        getLockedSubjectReferences: () => [],
        videoAspect: () => '16:9',
        minimaxService: { generateVideo: async (_frame: string, prompt: string) => { prompts.push(prompt); return 'https://cdn.example/v.mp4'; } },
      };
      const clip = await (HybridOrchestrator.prototype as any).regenerateShot.call(
        fake, 4, { shotNumber: 4, imageUrl: 'https://cdn.example/f.png', prompt: 'she turns away' },
        { videoProvider: 'minimax', ...opts },
      );
      return { clip, prompts };
    };

    it('传了 projectId:发给引擎的提示词带站位与朝向', async () => {
      staged();
      const { clip, prompts } = await run({ projectId: 'p1' });
      expect(clip.videoUrl).toBe('https://cdn.example/v.mp4');
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('she turns away. Staging: ');
      expect(prompts[0]).toContain('in profile, facing screen left toward 林晚');
    }, 20000);

    it('编排器自身已有 projectId(整片管线里的剪辑师重生)也生效', async () => {
      staged();
      const { prompts } = await run({}, 'p1');
      expect(prompts[0]).toContain('. Staging: ');
    }, 20000);

    it('没摆过位的镜:提示词与修前完全相同', async () => {
      stored.rows = [];
      const { prompts } = await run({ projectId: 'p1' });
      expect(prompts[0]).toBe('she turns away');
    }, 20000);
  });

  describe('调用方都把项目 id 交给了 regenerateShot', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    /** 取出每一处 `orchestrator.regenerateShot(` 调用的完整实参(按括号配平),不靠 indexOf 命中第一处 */
    const calls = (file: string) => {
      // 先去注释:heal-shots 文件头注释里就写着「orchestrator.regenerateShot(I2V 首帧锚定)」
      const src = fs.readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const out: string[] = [];
      let from = 0;
      for (;;) {
        const i = src.indexOf('orchestrator.regenerateShot(', from);
        if (i < 0) break;
        let depth = 0, j = src.indexOf('(', i);
        for (; j < src.length; j++) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')' && --depth === 0) break;
        }
        out.push(src.slice(i, j + 1));
        from = j;
      }
      return out;
    };

    it.each([
      ['app/api/projects/[id]/regenerate-shot/route.ts', 1, /projectId/],
      ['app/api/regenerate-shot/route.ts', 2, /projectId/],
      ['app/api/projects/[id]/heal-shots/route.ts', 1, /projectId: id/],
    ])('%s', (file, n, re) => {
      const cs = calls(file);
      expect(cs, '调用点数目变了 —— 新增的调用点也要带 projectId').toHaveLength(n);
      for (const c of cs) expect(c).toMatch(re);
    });

    it('4K 重渲(绕开编排器直调可灵)同样走注入口', () => {
      const route4kSrc = fs.readFileSync('app/api/projects/[id]/regenerate-shot-4k/route.ts', 'utf-8');
      expect(route4kSrc).toMatch(/const videoPrompt = await withStageDirective\(projectId, shotNumber, customPrompt \|\| storyboard\.prompt\)/);
      const i = route4kSrc.indexOf('k.regenerateShotAt4K(');
      expect(route4kSrc.slice(i, route4kSrc.indexOf(')', route4kSrc.indexOf('videoPrompt', i)) + 1)).toMatch(/storyboard\.imageUrl,\s*videoPrompt/);
    });

    it('全仓只剩这一个注入口:没有别处自己拼 stageDirectiveForShot', () => {
      const { execSync } = require('node:child_process');
      const hits = execSync('git grep -n "stageDirectiveForShot(" -- app services lib ":!lib/stage-blocking.ts" ":!lib/stage-scene-store.ts"', { encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean);
      // 允许:/stage 路由把提示词回显给界面、导演台弹窗预览 —— 都不出片
      for (const h of hits) expect(h, h).toMatch(/^(app\/api\/projects\/\[id\]\/stage\/route\.ts|components\/)/);
    });
  });
});

