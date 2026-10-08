'use client';

/**
 * components/project/stage3d-viewport (v12.439) — 导演台 3D 视口。
 *
 * 两种视角:
 *   · orbit —— 自由环绕看整个片场,可在地面上拖人、拖机位;
 *   · lens  —— 从机位看出去,**就是最终草图/提示词用的那台相机**。
 *
 * ── 为什么「机位视角」敢说所见即所得 ────────────────────────────
 * 这里没有另写投影:相机 fov / 宽高比 / 位置 / 朝向全部由 `stage-blocking` 的同一套参数给出,
 * 而 `projectScene` 与 `THREE.PerspectiveCamera.project()` 的一致性由
 * tests/v12-439-stage-3d-parity.test.ts 在 600 个点上逐点对拍(误差 < 1e-3)。
 * 修前纯几何有三处与真实相机对不上(角度当 tan、竖向用水平距离、底片恒为横向),
 * 那时画出来的 3D 与提示词会互相矛盾 —— 所以先修几何、再上 3D。
 *
 * 坐标映射:舞台 (x, z) → three (x, 0, −z)。舞台 +z 是「往前」,three 相机默认看 −z。
 * 相机朝向 yaw 在 three 里是绕 Y 轴转 −yaw(前向 = (sin yaw, 0, −cos yaw))。
 *
 * GPU:WebGL2,Mac 上浏览器经 ANGLE 走 Metal。按需渲染(frameloop="demand"),
 * 不拖动时不占 GPU。不支持 WebGL 由调用方退回 2D 预览(探测在弹窗里,不从本文件导入以免 three 进首包)。
 */

import { Component, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Line } from '@react-three/drei';
import { Plane, Vector3, WebGLRenderer, type Camera, type Object3D } from 'three';
import {
  horizontalFovDeg, verticalFovDeg, frameSize,
  type StageScene, type ProjectedActor,
} from '@/lib/stage-blocking';
import { mannequin3D } from '@/lib/pose-skeleton';

export type Stage3DView = 'orbit' | 'lens';

const IN_FRAME = '#f5b43c';
const OFF_FRAME = '#b43c3c';
const CAMERA = '#50a0ff';
const DEFAULT_ACTOR_H = 1.7;
const DEFAULT_CAM_H = 1.6;
/** 与俯视图同一片场范围,拖出去就夹回来 —— 两个视图的可摆范围不能不一样 */
const BOUNDS = { x: 6, zMin: -2, zMax: 12 };
const GROUND = new Plane(new Vector3(0, 1, 0), 0);

const toThree = (x: number, z: number, y = 0): [number, number, number] => [x, y, -z];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 俯仰(弧度,正 = 抬头);没设 = 平视 */
const camPitchRad = (cam: StageScene['camera']) => ((Number.isFinite(cam.pitchDeg) ? (cam.pitchDeg as number) : 0) * Math.PI) / 180;
/**
 * 相机朝向(v12.465 起带俯仰)。必须 YXZ:先在相机自身坐标里低头/抬头,再整体转向 ——
 * three 默认 XYZ 会先转向再绕**世界** X 轴倾,yaw 不为 0 时镜头就歪成荷兰角。
 */
export const cameraEuler = (cam: StageScene['camera']): [number, number, number, 'YXZ'] =>
  [camPitchRad(cam), (-cam.yawDeg * Math.PI) / 180, 0, 'YXZ'];

/**
 * 机位视锥线段(three 坐标,成对端点)。导出给测试:视锥的张角必须与 `projectScene` 的画幅一致,
 * 否则自由视角里「看起来在锥里」的人,在机位视角里却出画。
 */
export function frustumSegments(scene: StageScene, lengthM = 4): [number, number, number][] {
  const cam = scene.camera;
  const tanH = Math.tan((horizontalFovDeg(cam.lens, scene.aspect) * Math.PI) / 360);
  const tanV = Math.tan((verticalFovDeg(cam.lens, scene.aspect) * Math.PI) / 360);
  const yaw = (cam.yawDeg * Math.PI) / 180;
  const pitch = camPitchRad(cam);
  const h = cam.heightM ?? DEFAULT_CAM_H;
  const apex = toThree(cam.x, cam.z, h);
  // 相机局部坐标:右 = +x,上 = +y,前 = −z;先绕 X 转俯仰(v12.465),再绕 Y 转 −yaw —— 与相机的 YXZ 欧拉角同一顺序
  const world = (lx: number, ly0: number, lz0: number): [number, number, number] => {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ly = ly0 * cp - lz0 * sp, lz = ly0 * sp + lz0 * cp;
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    return [apex[0] + lx * c + lz * s, apex[1] + ly, apex[2] - lx * s + lz * c];
  };
  const L = lengthM;
  const corners = [
    world(-tanH * L, tanV * L, -L), world(tanH * L, tanV * L, -L),
    world(tanH * L, -tanV * L, -L), world(-tanH * L, -tanV * L, -L),
  ];
  const segs: [number, number, number][] = [];
  for (const c of corners) segs.push(apex, c);
  for (let i = 0; i < 4; i++) segs.push(corners[i], corners[(i + 1) % 4]);
  return segs;
}

type Drag = { kind: 'actor'; id: string } | { kind: 'camera' } | null;

/**
 * 人偶绕 Y 轴的转角(弧度);没设朝向返回 null(v12.440)。
 *
 * three 里绕 Y 转 θ 把局部前方 (0,0,−1) 变成 (−sin θ, 0, −cos θ);
 * 舞台朝向 f 的方向 (sin f, cos f) 映射到 three 是 (sin f, 0, −cos f) —— 所以 θ = −f。
 * 与机位的 −yaw 同一约定,测试里用 three 的 Euler 真转一遍对拍。
 */
export function mannequinYawRad(facingDeg: number | undefined): number | null {
  return typeof facingDeg === 'number' && Number.isFinite(facingDeg) ? (-facingDeg * Math.PI) / 180 : null;
}

/**
 * 名字标签的屏幕位置(v12.460)。与 drei `<Html center>` 同一套算法:世界坐标 → project → 画布像素,
 * 标签自身再用 translate(-50%,-50%) 居中;在相机背后或近裁剪面之内的不显示。
 */
export function projectLabel(world: Vector3, camera: Camera, size: { width: number; height: number }) {
  const v = world.clone().project(camera);
  const visible = Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.z) <= 1;
  return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, visible };
}

type AnchorMap = RefObject<Map<string, Object3D>>;
type LabelMap = RefObject<Map<string, HTMLElement>>;

/**
 * 名字标签不用 drei `<Html>`(v12.460)。
 *
 * `<Html>` 会在 3D 场景里**另起一个 ReactDOM 根**,卸载时同步 `root.unmount()` 再 `removeChild`。
 * r3f 9.8 起场景拆除挪到「React 提交卸载的那一刻」同步执行 —— 正撞上 React 的
 * 「Attempted to synchronously unmount a root while React was already rendering」,紧跟一条未捕获的
 * `removeChild` NotFoundError。真浏览器 A/B:r3f 9.7 干净,9.8.0 / 9.8.1 每次切回平面或关台都报;
 * 只拿掉 `<Html>` 就干净(e2e/stage3d.spec.ts)。
 *
 * 现在:标签是画布**外面**的普通 DOM(外层 React 树渲染,不再有嵌套根),
 * 场景里只留一个锚点;这里每帧把锚点投影成像素,直接写标签的 transform。
 * 锚点挂在人偶那个 group 里 —— 躺倒、转向都跟着同一套变换走,不另算一遍。
 */
function LabelProjector({ anchors, labels }: { anchors: AnchorMap; labels: LabelMap }) {
  const world = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, el] of labels.current) {
      const anchor = anchors.current.get(id);
      const p = anchor ? projectLabel(anchor.getWorldPosition(world), camera, size) : null;
      if (!p?.visible) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
    }
  });
  return null;
}

function Mannequin({
  actor, inFrame, draggable, onDragStart, labelAnchor,
}: {
  actor: StageScene['actors'][number];
  inFrame: boolean;
  draggable: boolean;
  onDragStart: (e: ThreeEvent<PointerEvent>) => void;
  labelAnchor: (obj: Object3D | null) => void;
}) {
  // v12.445:人偶按姿态变矮/放倒/长出四肢 —— 与 `projectScene` 和布局草图共用同一张骨架表。
  // 修前 3D 人偶只认 heightM:v12.443 起几何已经把坐着的人压矮了,3D 里却还站着(两套口径)。
  const standH = actor.heightM ?? DEFAULT_ACTOR_H;
  const m = mannequin3D(standH, actor.posePreset);
  const h = m.heightM;
  const headR = standH * 0.07;          // 头不随姿态缩放 —— 坐下只是矮了,头没变小
  const bodyR = standH * 0.1;
  const bodyTop = m.torsoTopM;
  const bodyLen = Math.max(0.01, bodyTop - m.torsoBottomM);
  const color = inFrame ? IN_FRAME : OFF_FRAME;
  const [x, , z] = toThree(actor.x, actor.z);
  const yaw = mannequinYawRad(actor.facingDeg);
  // 躺倒:整体放倒(绕 X 轴 −90°),脚底那一端留在原地
  const lie: [number, number, number] = m.lying ? [-Math.PI / 2, 0, 0] : [0, 0, 0];
  return (
    <group position={[x, m.lying ? bodyR : 0, z]} rotation={[lie[0], yaw ?? 0, 0]}>
      <mesh position={[0, m.torsoBottomM + bodyLen / 2, 0]} onPointerDown={draggable ? onDragStart : undefined}>
        <capsuleGeometry args={[bodyR, bodyLen, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, bodyTop + headR * 0.6, 0]} onPointerDown={draggable ? onDragStart : undefined}>
        <sphereGeometry args={[headR, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* 四肢:与草图同一张骨架表,设了姿态才画 */}
      {m.limbs.map(([a, b], i) => (
        <Line key={i} points={[a, b]} color={color} lineWidth={3} />
      ))}
      {/* 面罩 + 胸牌:只在设了朝向时画。没设就不画 —— 画了等于暗示「他朝这边」会进提示词,而实际上不会 */}
      {yaw !== null && (
        <>
          <mesh position={[0, bodyTop + headR * 0.6, -headR * 0.85]}>
            <boxGeometry args={[headR * 1.3, headR * 0.45, headR * 0.5]} />
            <meshStandardMaterial color="#1b1d22" roughness={0.3} />
          </mesh>
          <mesh position={[0, bodyTop - bodyR * 1.2, -bodyR * 0.95]}>
            <boxGeometry args={[bodyR * 0.9, bodyR * 0.9, bodyR * 0.2]} />
            <meshStandardMaterial color="#1b1d22" roughness={0.4} />
          </mesh>
        </>
      )}
      {/* 名字标签的锚点:标签本身在画布外(见 LabelProjector) */}
      <group ref={labelAnchor} position={[0, h + 0.18, 0]} />
    </group>
  );
}

function StageContents({
  scene, projected, view, onActorMove, onCameraMove, anchors,
}: {
  scene: StageScene;
  projected: ProjectedActor[];
  view: Stage3DView;
  onActorMove?: (id: string, x: number, z: number) => void;
  onCameraMove?: (x: number, z: number) => void;
  anchors: AnchorMap;
}) {
  const drag = useRef<Drag>(null);
  const [dragging, setDragging] = useState(false);
  const end = () => { drag.current = null; setDragging(false); };
  const cam = scene.camera;
  const camH = cam.heightM ?? DEFAULT_CAM_H;
  const vfov = verticalFovDeg(cam.lens, scene.aspect);
  const segments = useMemo(() => frustumSegments(scene), [scene]);
  const inFrame = useMemo(() => new Map(projected.map((p) => [p.id, p.inFrame])), [projected]);
  const canDrag = view === 'orbit';

  const start = (target: Drag) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    drag.current = target;
    setDragging(true);
    // 松手在画布外、或指针从地面滑到人身上都不能漏掉「结束」—— 挂在 window 上一次性收
    window.addEventListener('pointerup', end, { once: true });
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    const t = drag.current;
    if (!t) return;
    const hit = e.ray.intersectPlane(GROUND, new Vector3());
    if (!hit) return;   // 射线平行地面或朝天 —— 这一帧不动,好过把人甩到无穷远
    const x = Number(clamp(hit.x, -BOUNDS.x, BOUNDS.x).toFixed(2));
    const z = Number(clamp(-hit.z, BOUNDS.zMin, BOUNDS.zMax).toFixed(2));
    if (t.kind === 'camera') onCameraMove?.(x, z);
    else onActorMove?.(t.id, x, z);
  };
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 8, 3]} intensity={1.1} />

      {view === 'lens' ? (
        // 就是出片那台相机:竖向 fov + 宽高比由画布尺寸给出(容器 aspect-ratio = 画幅)
        <PerspectiveCamera
          makeDefault fov={vfov} near={0.05} far={200}
          position={toThree(cam.x, cam.z, camH)}
          rotation={cameraEuler(cam)}
        />
      ) : (
        <>
          <PerspectiveCamera makeDefault fov={50} position={[7, 7, 4]} near={0.1} far={400} />
          <OrbitControls makeDefault enabled={!dragging} target={[0, 0.8, -5]} maxPolarAngle={Math.PI / 2 - 0.05} />
        </>
      )}

      <Grid
        args={[40, 40]} position={[0, 0, -5]} cellSize={1} sectionSize={5}
        cellColor="#3a3f48" sectionColor="#5a6170" fadeDistance={45} infiniteGrid
      />

      {/* 拖动接收面:透明地面,指针捕获后在这里持续拿射线 */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, -5]}
        onPointerMove={move}
      >
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {scene.actors.map((a) => (
        <group key={a.id} onPointerMove={move}>
          <Mannequin
            actor={a} inFrame={inFrame.get(a.id) ?? false}
            draggable={canDrag} onDragStart={start({ kind: 'actor', id: a.id })}
            labelAnchor={(obj) => { if (obj) anchors.current.set(a.id, obj); else anchors.current.delete(a.id); }}
          />
        </group>
      ))}

      {view === 'orbit' && (
        <group onPointerMove={move}>
          <mesh position={toThree(cam.x, cam.z, camH)} rotation={cameraEuler(cam)}
            onPointerDown={canDrag ? start({ kind: 'camera' }) : undefined}>
            <boxGeometry args={[0.3, 0.22, 0.4]} />
            <meshStandardMaterial color={CAMERA} />
          </mesh>
          <Line points={segments} segments color={CAMERA} lineWidth={1.5} transparent opacity={0.8} />
        </group>
      )}
    </>
  );
}

/**
 * 建渲染器;建不起来就通知调用方退回 2D,然后**同步抛出**。
 *
 * 为什么先通知、不靠 ErrorBoundary:r3f 9.7 的 `<Canvas>` 在一个 async `run()` 里 `await configure()`,
 * `new WebGLRenderer` 抛的错成了**未处理的 Promise 拒绝** —— 既不进 r3f 自己的边界,也不进外层边界。
 * v12.439 在真浏览器里强制 getContext 失败实测:只有控制台一条报错,界面剩一块黑框。
 * 所以由工厂直接回调父组件切 fallback,不指望错误一路冒上来。
 *
 * 为什么现在是抛出、而不是返回一个永不完成的 Promise(v12.460):那是 r3f 9.7 下为了不产生未处理拒绝的办法。
 * r3f 9.8 起 configure 同步执行并 try/catch 工厂 —— 同步抛出会被接住、把 root.ready 置为 rejected,
 * 并由 `<Canvas>` 的 `.catch(setError)` 收下,不再有未处理拒绝。反倒是悬着的 Promise 在 9.8 下有害:
 * 卸载时的 teardown 要等 root.ready 落定才动手,永远等不到 —— 画布和整个根一直留在 r3f 的 `_roots` 里,
 * 每失败一次漏一份(三视角复查报出,测试里用真的 createRoot / unmount 对拍)。
 */
export function makeRendererFactory(onFail: (err: unknown) => void) {
  return (defaults: { canvas: HTMLCanvasElement | OffscreenCanvas } & Record<string, unknown>) => {
    try {
      const gl = new WebGLRenderer({ ...defaults, antialias: true, powerPreference: 'high-performance' } as any);
      if (!gl.capabilities.isWebGL2) {
        gl.dispose();
        throw new Error('WebGL2 不可用');
      }
      return gl;
    } catch (err) {
      onFail(err);
      throw err;
    }
  };
}

export class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('[stage3d] 3D 视口渲染失败,退回 2D:', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function Stage3DViewport({
  scene, projected, view, onActorMove, onCameraMove, fallback,
}: {
  scene: StageScene;
  projected: ProjectedActor[];
  view: Stage3DView;
  onActorMove?: (id: string, x: number, z: number) => void;
  onCameraMove?: (x: number, z: number) => void;
  /** WebGL 起不来时显示的内容(调用方传 2D 预览) */
  fallback: ReactNode;
}) {
  const { width, height } = frameSize(scene.aspect);
  const [glFailed, setGlFailed] = useState(false);
  const anchors = useRef(new Map<string, Object3D>());
  const labels = useRef(new Map<string, HTMLElement>());
  const glFactory = useMemo(() => makeRendererFactory((err) => {
    console.warn('[stage3d] WebGL 渲染器建不起来,退回 2D:', err);
    setGlFailed(true);
  }), []);
  if (glFailed) return <>{fallback}</>;
  // 机位视角的画布宽高比必须等于画幅 —— three 的 aspect 取自画布尺寸,比例一错人就被拉伸、出画判定对不上
  const ratio = view === 'lens' ? `${width} / ${height}` : '4 / 3';
  return (
    <GlBoundary fallback={fallback}>
      <div
        className="relative w-full overflow-hidden rounded-md border border-[var(--cinema-border)] bg-[#15171c] mx-auto touch-none"
        style={{ aspectRatio: ratio, maxHeight: 420, maxWidth: view === 'lens' ? `${(420 * width) / height}px` : undefined }}
        data-stage3d-view={view}
      >
        <Canvas
          frameloop="demand" dpr={[1, 2]} gl={glFactory as any}
        >
          <StageContents scene={scene} projected={projected} view={view} onActorMove={onActorMove} onCameraMove={onCameraMove} anchors={anchors} />
          <LabelProjector anchors={anchors} labels={labels} />
        </Canvas>
        {/* 名字标签:画布外的普通 DOM,位置由 LabelProjector 每帧写入;首帧前先藏着,免得在左上角闪一下 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" data-stage3d-labels>
          {scene.actors.map((a) => (
            <span
              key={a.id}
              ref={(el) => { if (el) labels.current.set(a.id, el); else labels.current.delete(a.id); }}
              data-stage3d-label={a.id}
              style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', fontSize: 11, whiteSpace: 'nowrap', color: '#fff', textShadow: '0 1px 2px #000' }}
            >
              {a.name || a.id}
            </span>
          ))}
        </div>
        {view === 'lens' && (
          // 三分线叠加在画布上方,和 2D 预览/PNG 草图同一套参考线
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 border-l border-white/20" />
            <div className="absolute inset-y-0 left-2/3 border-l border-white/20" />
            <div className="absolute inset-x-0 top-1/3 border-t border-white/20" />
            <div className="absolute inset-x-0 top-2/3 border-t border-white/20" />
          </div>
        )}
      </div>
    </GlBoundary>
  );
}
