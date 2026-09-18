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

import { Component, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Line, Html } from '@react-three/drei';
import { Plane, Vector3, WebGLRenderer } from 'three';
import {
  horizontalFovDeg, verticalFovDeg, frameSize,
  type StageScene, type ProjectedActor,
} from '@/lib/stage-blocking';

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

/**
 * 机位视锥线段(three 坐标,成对端点)。导出给测试:视锥的张角必须与 `projectScene` 的画幅一致,
 * 否则自由视角里「看起来在锥里」的人,在机位视角里却出画。
 */
export function frustumSegments(scene: StageScene, lengthM = 4): [number, number, number][] {
  const cam = scene.camera;
  const tanH = Math.tan((horizontalFovDeg(cam.lens, scene.aspect) * Math.PI) / 360);
  const tanV = Math.tan((verticalFovDeg(cam.lens, scene.aspect) * Math.PI) / 360);
  const yaw = (cam.yawDeg * Math.PI) / 180;
  const h = cam.heightM ?? DEFAULT_CAM_H;
  const apex = toThree(cam.x, cam.z, h);
  // 相机局部坐标:右 = +x,上 = +y,前 = −z;再绕 Y 转 −yaw
  const world = (lx: number, ly: number, lz: number): [number, number, number] => {
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

function Mannequin({
  actor, inFrame, draggable, onDragStart,
}: {
  actor: StageScene['actors'][number];
  inFrame: boolean;
  draggable: boolean;
  onDragStart: (e: ThreeEvent<PointerEvent>) => void;
}) {
  // 头顶恰好在 heightM、脚底在地面 —— 与 projectScene 的 screenTop/screenBottom 量的是同一段
  const h = actor.heightM ?? DEFAULT_ACTOR_H;
  const headR = h * 0.07;
  const bodyR = h * 0.1;
  const bodyTop = h - headR * 2 - h * 0.01;
  const bodyLen = Math.max(0.01, bodyTop - bodyR * 2);
  const color = inFrame ? IN_FRAME : OFF_FRAME;
  const [x, , z] = toThree(actor.x, actor.z);
  const yaw = mannequinYawRad(actor.facingDeg);
  return (
    <group position={[x, 0, z]} rotation={[0, yaw ?? 0, 0]}>
      <mesh position={[0, bodyR + bodyLen / 2, 0]} onPointerDown={draggable ? onDragStart : undefined}>
        <capsuleGeometry args={[bodyR, bodyLen, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, h - headR, 0]} onPointerDown={draggable ? onDragStart : undefined}>
        <sphereGeometry args={[headR, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* 面罩 + 胸牌:只在设了朝向时画。没设就不画 —— 画了等于暗示「他朝这边」会进提示词,而实际上不会 */}
      {yaw !== null && (
        <>
          <mesh position={[0, h - headR, -headR * 0.85]}>
            <boxGeometry args={[headR * 1.3, headR * 0.45, headR * 0.5]} />
            <meshStandardMaterial color="#1b1d22" roughness={0.3} />
          </mesh>
          <mesh position={[0, bodyTop - bodyR * 1.6, -bodyR * 0.95]}>
            <boxGeometry args={[bodyR * 0.9, bodyR * 0.9, bodyR * 0.2]} />
            <meshStandardMaterial color="#1b1d22" roughness={0.4} />
          </mesh>
        </>
      )}
      <Html position={[0, h + 0.18, 0]} center style={{ pointerEvents: 'none' }}>
        <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: '#fff', textShadow: '0 1px 2px #000' }}>
          {actor.name || actor.id}
        </span>
      </Html>
    </group>
  );
}

function StageContents({
  scene, projected, view, onActorMove, onCameraMove,
}: {
  scene: StageScene;
  projected: ProjectedActor[];
  view: Stage3DView;
  onActorMove?: (id: string, x: number, z: number) => void;
  onCameraMove?: (x: number, z: number) => void;
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
          rotation={[0, (-cam.yawDeg * Math.PI) / 180, 0]}
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
          />
        </group>
      ))}

      {view === 'orbit' && (
        <group onPointerMove={move}>
          <mesh position={toThree(cam.x, cam.z, camH)} rotation={[0, (-cam.yawDeg * Math.PI) / 180, 0]}
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
 * 建渲染器;建不起来就通知调用方退回 2D。
 *
 * 为什么不靠 ErrorBoundary:r3f v9 的 `<Canvas>` 在一个 async `run()` 里 `await configure()`,
 * `new WebGLRenderer` 抛的错成了**未处理的 Promise 拒绝** —— 既不进 r3f 自己的边界,也不进外层边界。
 * v12.439 在真浏览器里强制 getContext 失败实测:只有控制台一条报错,界面剩一块黑框。
 * (onCreated 里 throw 同理,也在那个 async 里,一样接不住。)
 *
 * 失败时返回一个永不完成的 Promise:configure 就停在这里、不再报错;
 * 调用方随即卸掉 Canvas 换成 fallback,这个悬着的 Promise 跟着被回收。
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
      return new Promise<WebGLRenderer>(() => {});
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
          <StageContents scene={scene} projected={projected} view={view} onActorMove={onActorMove} onCameraMove={onCameraMove} />
        </Canvas>
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
