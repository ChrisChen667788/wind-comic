'use client';

/**
 * components/project/director-stage-modal (v12.318) — 导演台。
 *
 * 左:俯视图,拖人、拖机位、转朝向。右:相机视角实时预览 + 构图体检 + 会进提示词的那句话。
 *
 * ── 为什么预览在客户端画,而不是每拖一下问服务器 ──────────────────
 * `lib/stage-blocking` 是零依赖纯几何,浏览器里能直接跑 —— 拖动要跟手就不能有往返。
 * 关键是**用的是同一个 `projectScene`**:预览、体检、提示词描述、服务端渲的 PNG 草图,
 * 四处同源。若前端另画一套「差不多」的预览,用户看到的构图就会和最终出片对不上,
 * 那正是本仓栽过五次的「同一语义两套口径」。
 *
 * 服务端只在两件事上出手:落库(POST /stage)与渲 PNG 草图(shot-sketch mode:'stage')。
 *
 * ── v12.439:画幅 + 3D ─────────────────────────────────────────
 * 几何现在按项目画幅算(`aspect` 属性)。弹窗里所有几何调用都吃 `framed`(挂了画幅的场景),
 * 不吃裸 `scene` —— 否则预览按 36×24 算、服务端按 9:16 算,又是两套口径。
 * 3D 视口按需加载(three + r3f + drei 生产构建一个 948KB 的 chunk,不进项目页首包),WebGL2 不可用时整块退回 2D 预览。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FloppyDisk as Save, CircleNotch as Loader2, Image as ImageIcon, Warning } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  projectScene, auditStaging, describeStaging, horizontalFovDeg, stageDirectiveForShot, frameSize, facingFromPoint, normalizeFacingDeg,
  POSE_PRESETS,
  type StageScene, type StageActor, type PosePresetId,
} from '@/lib/stage-blocking';
import type { LensId } from '@/lib/cinematography';
import { PosePhotoButton } from './pose-photo-button';

/**
 * 不能从 stage3d-viewport 静态导入 —— 那会把 three 整个拖进项目页首包,dynamic() 就白做了。
 * SSR 与无 WebGL2 的环境都返回 false。
 */
function webgl2Available(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const Stage3DViewport = dynamic(() => import('./stage3d-viewport'), {
  ssr: false,
  loading: () => <div className="w-full aspect-[4/3] rounded-md border border-[var(--cinema-border)] animate-pulse" />,
});

/** 右侧预览:2D 平面剪影 / 3D 机位视角(出片那台相机)/ 3D 自由环绕 */
type PreviewMode = '2d' | 'lens' | 'orbit';
const PREVIEW_MODES: { id: PreviewMode; label: string }[] = [
  { id: 'lens', label: '3D 机位视角' },
  { id: 'orbit', label: '3D 自由视角' },
  { id: '2d', label: '平面' },
];

const LENSES: LensId[] = ['18', '24', '35', '50', '85', '100'];

/** 俯视图世界范围(米):左右 ±6,纵深 -2 ~ 12 */
const WX = 6, ZMIN = -2, ZMAX = 12;
const PW = 340, PH = 300;

const wx2px = (x: number) => ((x + WX) / (2 * WX)) * PW;
const wz2py = (z: number) => PH - ((z - ZMIN) / (ZMAX - ZMIN)) * PH;
const px2wx = (px: number) => (px / PW) * 2 * WX - WX;
const py2wz = (py: number) => ((PH - py) / PH) * (ZMAX - ZMIN) + ZMIN;

type DragTarget = { kind: 'actor'; id: string } | { kind: 'facing'; id: string } | { kind: 'camera' } | null;

/** 俯视图朝向箭头的长度(米)—— 按世界坐标算再映射成像素,俯视图横纵比例尺不同,直接用像素画角度会歪 */
const FACING_ARROW_M = 0.8;
/** 拖朝向时吸附到 5° 整数倍,免得存进一堆 87.3° 这种没意义的精度 */
const FACING_SNAP_DEG = 5;
/** 键盘:方向键每次移动(米),按住 Shift 为大步;Q / E 每次转朝向(度) */
const KEY_STEP_M = 0.1, KEY_BIG_STEP_M = 0.5, KEY_TURN_DEG = 15;
const clampStage = (x: number, z: number) => ({
  x: Number(Math.max(-WX, Math.min(WX, x)).toFixed(2)),
  z: Number(Math.max(ZMIN, Math.min(ZMAX, z)).toFixed(2)),
});

export function DirectorStageModal({
  projectId, shotNumber, shotTitle, initialScene, characterNames, aspect, onClose, onSaved,
}: {
  projectId: string;
  shotNumber: number;
  shotTitle?: string;
  /** 项目画幅(如 '9:16');决定画面宽高比 → 谁在画内、景别多大。与服务端 getStageScene 挂的是同一个值 */
  aspect?: string | null;
  initialScene?: StageScene | null;
  /** 该镜出场角色 —— 直接用剧本里的名字建人,不让用户再敲一遍 */
  characterNames?: string[];
  onClose: () => void;
  onSaved?: (scene: StageScene) => void;
}) {
  const [scene, setScene] = useState<StageScene>(() =>
    initialScene?.camera
      ? initialScene
      : {
          camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 },
          actors: (characterNames?.length ? characterNames : ['角色 A']).slice(0, 6).map((n, i) => ({
            id: `a${i}`, name: n, x: (i - ((characterNames?.length || 1) - 1) / 2) * 1.4, z: 5,
          })),
        },
  );
  const [saving, setSaving] = useState(false);
  const [sketching, setSketching] = useState(false);
  const [msg, setMsg] = useState('');
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const dragRef = useRef<DragTarget>(null);
  /**
   * 发起拖动的那根指针(v12.440 第二轮审查补)。多指触摸时,另一根手指进出俯视图也会触发
   * pointerleave / pointermove —— 不认指针,离开时会把「别的手指」捕获过来,之后它的移动就在拖人。
   */
  const dragPointerRef = useRef<number | null>(null);
  const startDrag = (e: React.PointerEvent, target: NonNullable<DragTarget>) => {
    e.preventDefault();
    dragRef.current = target;
    dragPointerRef.current = e.pointerId;
  };
  const endDrag = (e: React.PointerEvent) => {
    if (dragPointerRef.current !== null && e.pointerId !== dragPointerRef.current) return;
    dragRef.current = null;
    dragPointerRef.current = null;
  };
  const [focusId, setFocusId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [preview, setPreview] = useState<PreviewMode>('2d');
  const [gl, setGl] = useState(false);
  // WebGL2 探测放到挂载后:SSR 时没有 document,首帧一律 2D,避免水合不一致
  useEffect(() => {
    const ok = webgl2Available();
    // 两个状态一起定:只 `if (ok) setPreview('lens')` 时,开发模式 StrictMode 二次执行若探测结果不同,
    // 会出现「只剩平面选项、却显示着 3D 黑框」(v12.439 浏览器实测)
    setGl(ok);
    setPreview(ok ? 'lens' : '2d');
  }, []);

  // 画幅以项目为准:initialScene 从 GET 带回的 aspect 也可能是旧值,prop 优先
  const framed = useMemo<StageScene>(
    () => ({ ...scene, aspect: aspect || scene.aspect }),
    [scene, aspect],
  );
  const projected = useMemo(() => projectScene(framed), [framed]);
  const issues = useMemo(() => auditStaging(framed), [framed]);
  const description = useMemo(() => describeStaging(framed), [framed]);
  const directive = useMemo(() => stageDirectiveForShot(framed), [framed]);
  const frame = frameSize(framed.aspect, 320 * 180);

  function patchCamera(p: Partial<StageScene['camera']>) {
    setScene((s) => ({ ...s, camera: { ...s.camera, ...p } }));
  }
  function patchActor(id: string, p: Partial<StageActor>) {
    setScene((s) => ({ ...s, actors: s.actors.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragPointerRef.current !== null && e.pointerId !== dragPointerRef.current) return;
    const t = dragRef.current;
    if (!t || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = px2wx(((e.clientX - r.left) / r.width) * PW);
    const z = py2wz(((e.clientY - r.top) / r.height) * PH);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const nx = Number(clamp(x, -WX, WX).toFixed(2));
    const nz = Number(clamp(z, ZMIN, ZMAX).toFixed(2));
    if (t.kind === 'camera') patchCamera({ x: nx, z: nz });
    else if (t.kind === 'facing') {
      const a = scene.actors.find((q) => q.id === t.id);
      const deg = a ? facingFromPoint(a, x, z, FACING_SNAP_DEG) : null;
      if (deg !== null) patchActor(t.id, { facingDeg: deg });   // null = 指针还压在人身上,方向无定义
    } else patchActor(t.id, { x: nx, z: nz });
  }

  /**
   * 键盘摆位(v12.440 审查补):俯视图原本只能用鼠标拖,键盘用户摆不了位、转不了朝向。
   * 方向键移动(↑ = 离机位更远,与俯视图上方一致),Shift 大步;Q / E 逆 / 顺时针转朝向,
   * 未设朝向时第一次按先设成「朝向机位」;Delete / Backspace 清除朝向。
   */
  function onStageKey(e: React.KeyboardEvent, target: { kind: 'actor'; id: string } | { kind: 'camera' }) {
    const step = e.shiftKey ? KEY_BIG_STEP_M : KEY_STEP_M;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, [number, number]>)[e.key];
    const a = target.kind === 'actor' ? scene.actors.find((q) => q.id === target.id) : undefined;
    if (d) {
      e.preventDefault();
      if (target.kind === 'camera') patchCamera(clampStage(scene.camera.x + d[0], scene.camera.z + d[1]));
      else if (a) patchActor(a.id, clampStage(a.x + d[0], a.z + d[1]));
      return;
    }
    if (!a) return;
    const key = e.key.toLowerCase();
    if (key === 'q' || key === 'e') {
      e.preventDefault();
      const set = typeof a.facingDeg === 'number' && Number.isFinite(a.facingDeg);
      const base = set ? (a.facingDeg as number) : facingFromPoint(a, scene.camera.x, scene.camera.z, KEY_TURN_DEG);
      if (base === null) return;   // 人和机位重合,「朝向机位」无定义
      patchActor(a.id, { facingDeg: set ? normalizeFacingDeg(base + (key === 'e' ? KEY_TURN_DEG : -KEY_TURN_DEG)) : base });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      patchActor(a.id, { facingDeg: undefined });
    }
  }

  async function save() {
    setSaving(true); setMsg('');
    try {
      const r = await fetch(`/api/projects/${projectId}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotNumber, actors: scene.actors, camera: scene.camera }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.message || b?.error || `HTTP ${r.status}`);
      setMsg('已保存 —— 该镜后续出片会带上这份站位');
      onSaved?.(scene);
    } catch (e) {
      setMsg(`保存失败:${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  }

  async function renderSketch() {
    setSketching(true); setMsg('');
    try {
      // 先存再渲 —— 服务端按**库里的**舞台渲图,不存就渲的是上一次的位置
      const s = await fetch(`/api/projects/${projectId}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotNumber, actors: scene.actors, camera: scene.camera }),
      });
      if (!s.ok) throw new Error(`保存舞台失败 HTTP ${s.status}`);
      const r = await fetch(`/api/projects/${projectId}/shot-sketch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotNumber, mode: 'stage' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || `HTTP ${r.status}`);
      setSketchUrl(b.sketchUrl);
      setMsg('草图已生成 —— 重生该镜分镜图时开启草图锁即用它锁构图');
    } catch (e) {
      setMsg(`渲草图失败:${e instanceof Error ? e.message : String(e)}`);
    } finally { setSketching(false); }
  }

  const fov = horizontalFovDeg(framed.camera.lens, framed.aspect);
  const camPx = wx2px(scene.camera.x), camPy = wz2py(scene.camera.z);
  // v12.440:扇形边线先在**世界坐标**里算再映射。俯视图横向 28.3px/m、纵向 21.4px/m,
  // 修前直接在像素里按角度画,扇形张角与真实视角不符 —— 站在扇形边上的人,颜色(几何判定)和位置(扇形)对不上。
  const frustum = (sign: number) => {
    const a = ((scene.camera.yawDeg + sign * fov / 2) * Math.PI) / 180;
    const far = 40;
    return `${wx2px(scene.camera.x + Math.sin(a) * far)},${wz2py(scene.camera.z + Math.cos(a) * far)}`;
  };

  const flat = (
    // 盒子本身按画幅收窄(与 3D 视口同一约束)—— 只靠 viewBox 会在竖屏时左右留出大片白底,看着像画面很宽
    <svg viewBox={`0 0 ${frame.width} ${frame.height}`}
      className="block w-full mx-auto rounded-md border border-[var(--cinema-border)] bg-white"
      style={{ aspectRatio: `${frame.width} / ${frame.height}`, maxHeight: 420, maxWidth: `${(420 * frame.width) / frame.height}px` }}>
      <line x1={frame.width / 3} y1={0} x2={frame.width / 3} y2={frame.height} stroke="#ddd" />
      <line x1={(2 * frame.width) / 3} y1={0} x2={(2 * frame.width) / 3} y2={frame.height} stroke="#ddd" />
      <line x1={0} y1={frame.height / 2} x2={frame.width} y2={frame.height / 2} stroke="#ccc" />
      {projected.filter((p) => p.inFrame).sort((a, b) => b.distanceM - a.distanceM).map((p) => {
        const yTop = ((1 - p.screenTop) / 2) * frame.height;
        const yBot = ((1 - p.screenBottom) / 2) * frame.height;
        const h = Math.abs(yBot - yTop);
        const w = Math.max(2, h * 0.26);
        const x = ((p.screenX + 1) / 2) * frame.width;
        const tone = Math.round(150 - Math.max(0, Math.min(1, 1 - p.distanceM / 12)) * 90);
        const c = `rgb(${tone},${tone},${tone})`;
        return (
          <g key={p.id}>
            <rect x={x - w / 2} y={yTop + h * 0.198} width={w} height={Math.max(1, yBot - yTop - h * 0.198)} fill={c} stroke="#1e1e1e" strokeWidth={0.8} />
            <circle cx={x} cy={yTop + h * 0.09} r={Math.max(1, h * 0.09)} fill={c} />
          </g>
        );
      })}
    </svg>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{`导演台 · 第 ${shotNumber} 镜${shotTitle ? ` — ${shotTitle}` : ''}`}</DialogTitle>
          {/* 关闭按钮由 DialogContent 自带 —— v12.318 这里又画了一个,两个 ✕ 叠在右上角(v12.439 实测) */}
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* ── 俯视图:拖人、拖机位 ── */}
          <div>
            <p className="text-[11px] opacity-70 mb-1">俯视图 · 拖动人物或机位摆位 · 拖人物外圈转朝向,双击外圈清除 · 键盘:Tab 选中后方向键 / Q E</p>
            <svg
              ref={svgRef} viewBox={`0 0 ${PW} ${PH}`} className="w-full rounded-md border border-[var(--cinema-border)] touch-none"
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onLostPointerCapture={endDrag}
              onPointerLeave={(e) => {
                // 拖动中移出俯视图:改为捕获指针继续拖,而不是半路取消(朝向会停在一个中间角度,且没有任何提示)。
                // 不在按下时就捕获 —— 那样 click / dblclick 会改派给 svg,双击外圈清除朝向就失效了。
                if (!dragRef.current || e.pointerId !== dragPointerRef.current) return;
                // 不支持捕获(或指针已松开)时 setPointerCapture 会抛 —— 那就按修前取消拖动
                try { svgRef.current!.setPointerCapture(e.pointerId); } catch { dragRef.current = null; dragPointerRef.current = null; }
              }}
            >
              <rect width={PW} height={PH} fill="rgba(127,127,127,0.06)" />
              {/* 视野扇形 —— 一眼看出谁在画面里 */}
              <polygon points={`${camPx},${camPy} ${frustum(-1)} ${frustum(1)}`} fill="rgba(245,180,60,0.14)" />
              {scene.actors.map((a) => {
                const p = projected.find((q) => q.id === a.id);
                return (
                  <g key={a.id} data-actor={a.id} onPointerDown={(e) => startDrag(e, { kind: 'actor', id: a.id })} style={{ cursor: 'grab', outline: 'none' }}
                    tabIndex={0} role="button"
                    aria-label={`${a.name || a.id}:方向键移动(Shift 大步),Q / E 转朝向,Delete 清除朝向`}
                    onKeyDown={(e) => onStageKey(e, { kind: 'actor', id: a.id })}
                    onFocus={() => setFocusId(a.id)} onBlur={() => setFocusId((f) => (f === a.id ? null : f))}>
                    {focusId === a.id && (
                      <circle data-focus-ring={a.id} cx={wx2px(a.x)} cy={wz2py(a.z)} r={20} fill="none"
                        stroke="var(--cinema-amber, #f5b43c)" strokeWidth={2} pointerEvents="none" />
                    )}
                    {/* 朝向外圈:没设时虚线提示「可以转」;设了才画箭头 —— 箭头意味着「会进提示词」 */}
                    <circle
                      data-facing-ring={a.id}
                      cx={wx2px(a.x)} cy={wz2py(a.z)} r={15}
                      fill="none" stroke="currentColor" strokeOpacity={typeof a.facingDeg === 'number' ? 0.35 : 0.2}
                      strokeDasharray={typeof a.facingDeg === 'number' ? undefined : '2 3'}
                      strokeWidth={1}
                      pointerEvents="none"
                    />
                    {/* 加粗的透明描边当点击区,细线本身太难点中 */}
                    <circle
                      data-facing-handle={a.id}
                      cx={wx2px(a.x)} cy={wz2py(a.z)} r={15} fill="none" stroke="transparent" strokeWidth={8}
                      pointerEvents="stroke" style={{ cursor: 'alias' }}
                      onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { kind: 'facing', id: a.id }); }}
                      onDoubleClick={(e) => { e.stopPropagation(); patchActor(a.id, { facingDeg: undefined }); }}
                    >
                      <title>拖动转朝向,双击清除</title>
                    </circle>
                    {typeof a.facingDeg === 'number' && Number.isFinite(a.facingDeg) && (() => {
                      const r = (a.facingDeg * Math.PI) / 180;
                      const tx = wx2px(a.x + Math.sin(r) * FACING_ARROW_M);
                      const ty = wz2py(a.z + Math.cos(r) * FACING_ARROW_M);
                      return (
                        <line data-facing-arrow={a.id} x1={wx2px(a.x)} y1={wz2py(a.z)} x2={tx} y2={ty}
                          stroke="currentColor" strokeWidth={2} strokeLinecap="round" pointerEvents="none" />
                      );
                    })()}
                    <circle cx={wx2px(a.x)} cy={wz2py(a.z)} r={9}
                      fill={p?.inFrame ? 'rgba(245,180,60,0.85)' : 'rgba(180,60,60,0.7)'} />
                    <text x={wx2px(a.x)} y={wz2py(a.z) - 18} textAnchor="middle" fontSize={10} fill="currentColor">{a.name || a.id}</text>
                  </g>
                );
              })}
              <g onPointerDown={(e) => startDrag(e, { kind: 'camera' })} style={{ cursor: 'grab', outline: 'none' }}
                data-camera tabIndex={0} role="button" aria-label="机位:方向键移动(Shift 大步)"
                onKeyDown={(e) => onStageKey(e, { kind: 'camera' })}
                onFocus={() => setFocusId('__camera')} onBlur={() => setFocusId((f) => (f === '__camera' ? null : f))}>
                {focusId === '__camera' && (
                  <circle data-focus-ring="camera" cx={camPx} cy={camPy} r={14} fill="none"
                    stroke="var(--cinema-amber, #f5b43c)" strokeWidth={2} pointerEvents="none" />
                )}
                <circle cx={camPx} cy={camPy} r={8} fill="rgba(80,160,255,0.9)" />
                <text x={camPx} y={camPy + 20} textAnchor="middle" fontSize={9} fill="currentColor">机位</text>
              </g>
            </svg>

            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex items-center gap-1">朝向
                <input type="range" min={-180} max={180} value={scene.camera.yawDeg}
                  onChange={(e) => patchCamera({ yawDeg: Number(e.target.value) })} className="flex-1" />
                <span className="cinema-mono w-9 text-right">{scene.camera.yawDeg}°</span>
              </label>
              <label className="flex items-center gap-1">机高
                <input type="range" min={0.2} max={4} step={0.1} value={scene.camera.heightM ?? 1.6}
                  onChange={(e) => patchCamera({ heightM: Number(e.target.value) })} className="flex-1" />
                <span className="cinema-mono w-11 text-right">{(scene.camera.heightM ?? 1.6).toFixed(1)}m</span>
              </label>
              <label className="col-span-2 flex items-center gap-1">焦距
                {LENSES.map((l) => (
                  <button key={l} onClick={() => patchCamera({ lens: l })}
                    className={`px-1.5 py-0.5 rounded border text-[10px] ${scene.camera.lens === l ? 'border-[var(--cinema-amber)]' : 'border-[var(--cinema-border)] opacity-60'}`}>
                    {l}mm
                  </button>
                ))}
                <span className="cinema-mono opacity-60 ml-auto">{fov.toFixed(0)}° 视角</span>
              </label>
              {/* v12.441:姿态预设。只给固定词表不给自由输入 —— 提示词全链路是英文,
                  填中文动作会被视频模型当画面文字渲染(v2.22 的 CJK 乱码就是这么来的)。 */}
              <div className="col-span-2 space-y-1">
                {scene.actors.map((a) => (
                  <label key={a.id} className="flex flex-wrap items-center gap-1" data-pose-row={a.id}>
                    <span className="truncate max-w-[6rem]" title={a.name || a.id}>{a.name || a.id}</span>
                    <select
                      aria-label={`${a.name || a.id} 的姿态`}
                      value={a.posePreset ?? ''}
                      onChange={(e) => patchActor(a.id, { posePreset: (e.target.value || undefined) as PosePresetId | undefined })}
                      className="flex-1 bg-transparent border border-[var(--cinema-border)] rounded px-1 py-0.5 text-[11px]"
                    >
                      <option value="">姿态未设(不进提示词)</option>
                      {(Object.keys(POSE_PRESETS) as PosePresetId[]).map((id) => (
                        <option key={id} value={id}>{POSE_PRESETS[id].cn}</option>
                      ))}
                    </select>
                    {/* v12.444:上传参考照片,在本机认出姿态与朝向(照片不上传) */}
                    <PosePhotoButton
                      actorName={a.name || a.id}
                      onRead={(v) => patchActor(a.id, { posePreset: v.posePreset, ...(v.facingDeg !== undefined ? { facingDeg: v.facingDeg } : {}) })}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── 相机视角预览 + 体检 ── */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px]" role="tablist" aria-label="预览方式">
              {PREVIEW_MODES.filter((m) => gl || m.id === '2d').map((m) => (
                <button key={m.id} role="tab" aria-selected={preview === m.id} onClick={() => setPreview(m.id)}
                  className={`px-1.5 py-0.5 rounded border text-[10px] ${preview === m.id ? 'border-[var(--cinema-amber)]' : 'border-[var(--cinema-border)] opacity-60'}`}>
                  {m.label}
                </button>
              ))}
              <span className="ml-auto opacity-60">{preview === 'orbit' ? '拖人物/机位摆位 · 右键平移' : `画幅 ${framed.aspect || '未设'} · 与最终草图同一套几何`}</span>
            </div>
            {preview === '2d' ? flat : (
              <Stage3DViewport
                scene={framed} projected={projected} view={preview}
                fallback={(
                  <div>
                    {flat}
                    <p className="mt-1 text-[10px] opacity-60">这台设备建不起 3D 画布(WebGL2),已换成平面预览 —— 构图与草图口径不受影响</p>
                  </div>
                )}
                onActorMove={(aid, x, z) => patchActor(aid, { x, z })}
                onCameraMove={(x, z) => patchCamera({ x, z })}
              />
            )}

            <div className="mt-2 space-y-1 text-[11px]">
              {issues.length === 0 ? (
                <p className="opacity-60">构图无告警</p>
              ) : issues.map((i, k) => (
                <p key={k} className="flex items-start gap-1 text-[var(--cinema-amber)]">
                  <Warning size={12} className="mt-0.5 shrink-0" />{i.message}
                </p>
              ))}
              {description && <p className="opacity-75 leading-snug">{description}</p>}
              {directive && (
                <details className="opacity-60">
                  <summary className="cursor-pointer">会进提示词的那句(英文)</summary>
                  <code className="block mt-1 text-[10px] break-all">{directive}</code>
                </details>
              )}
            </div>
          </div>
        </div>

        {sketchUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          // v12.439:草图随项目画幅出竖图后,`w-full` 会把 540×960 撑到整屏高 —— 限高、宽度随比例
          <img src={sketchUrl} alt={`第 ${shotNumber} 镜布局草图`} className="mt-2 mx-auto block max-h-[420px] w-auto max-w-full rounded-md border border-[var(--cinema-border)]" />
        )}

        <div className="mt-3 flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--cinema-border)] hover:border-[var(--cinema-amber)] text-[12px] disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 保存站位
          </button>
          <button onClick={renderSketch} disabled={sketching}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--cinema-border)] hover:border-[var(--cinema-amber)] text-[12px] disabled:opacity-50"
            title="按当前舞台渲一张布局草图(不调引擎、不花钱)">
            {sketching ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />} 渲布局草图
          </button>
          {msg && <span className="text-[11px] opacity-75">{msg}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
