/**
 * lib/composition (v7.5) — 构图引导 + 运镜路径 (对标 CineMatrix Composition Guide / Camera Movement Path)
 *
 * 纯逻辑:
 *   - COMPOSITION_GUIDES: 构图法预设
 *   - computeCompositionHints(): 由景别/机位推断 主体位置/头部空间/视线空间/平衡
 *   - cameraPathPoints(): 由运镜类型给出 SVG 路径 + 焦点坐标 (viewBox 0 0 100 56), 供 mini 可视化
 */

import type { ShotSize, CameraAngle, MovementId } from './cinematography';

export type CompositionId = 'thirds' | 'golden' | 'center' | 'symmetry';

export const COMPOSITION_GUIDES: { id: CompositionId; label: string; prompt: string }[] = [
  { id: 'thirds',   label: '三分法',   prompt: 'rule of thirds composition' },
  { id: 'golden',   label: '黄金分割', prompt: 'golden ratio / fibonacci spiral composition' },
  { id: 'center',   label: '中心构图', prompt: 'centered composition' },
  { id: 'symmetry', label: '对称构图', prompt: 'symmetrical balanced composition' },
];

export const getComposition = (id: CompositionId) => COMPOSITION_GUIDES.find((c) => c.id === id);

export function compileCompositionPrompt(id: CompositionId): string {
  return getComposition(id)?.prompt || '';
}

export interface CompositionHints {
  facePosition: string;  // 主体/视觉焦点位置
  headroom: string;      // 头部空间
  lookRoom: string;      // 视线空间
  balance: string;       // 画面平衡
}

/** 由景别 + 机位 推断构图建议 (启发式, 对齐 CineMatrix Composition Guide) */
export function computeCompositionHints(opts: { shotSize?: ShotSize; angle?: CameraAngle }): CompositionHints {
  const size = opts.shotSize || 'MS';
  const angle = opts.angle || 'eye';

  let facePosition: string;
  if (size === 'CU' || size === 'ECU') facePosition = '上三分线 · 眼睛对齐';
  else if (size === 'MS' || size === 'LS') facePosition = '右三分线';
  else facePosition = '下三分线 · 主体偏小';

  let headroom: string;
  if (size === 'ECU') headroom = '极紧 · 可裁顶';
  else if (size === 'CU') headroom = '偏紧';
  else if (size === 'MS' || size === 'LS') headroom = '适中';
  else headroom = '充足';

  let lookRoom: string;
  if (angle === 'dutch') lookRoom = '倾斜 · 失衡张力';
  else if (size === 'WS' || size === 'ELS') lookRoom = '环境留白';
  else lookRoom = '视线前方留白';

  let balance: string;
  if (size === 'ELS' || size === 'WS') balance = '负空间';
  else if (size === 'CU' || size === 'ECU') balance = '主体偏置';
  else if (angle === 'low' || angle === 'high') balance = '对角动势';
  else balance = '均衡';

  return { facePosition, headroom, lookRoom, balance };
}

export interface CameraPathViz {
  /** SVG path d, viewBox 0 0 100 56 */
  path: string;
  /** 焦点坐标 */
  focusX: number;
  focusY: number;
  /** 起点 (画箭头/相机图标) */
  startX: number;
  startY: number;
  label: string;
}

const CX = 50, CY = 28;

/** 由运镜类型给 SVG 路径 + 焦点 (供 mini 运镜路径图) */
export function cameraPathPoints(movement: MovementId): CameraPathViz {
  switch (movement) {
    case 'push-in':
      return { path: `M10,28 L${CX},${CY}`, focusX: CX, focusY: CY, startX: 10, startY: 28, label: '推近' };
    case 'pull-out':
      return { path: `M${CX},${CY} L10,28`, focusX: 10, focusY: 28, startX: CX, startY: CY, label: '拉远' };
    case 'pan':
      return { path: 'M10,28 L90,28', focusX: 90, focusY: 28, startX: 10, startY: 28, label: '横摇' };
    case 'tilt':
      return { path: `M${CX},50 L${CX},6`, focusX: CX, focusY: 6, startX: CX, startY: 50, label: '纵摇' };
    case 'dolly':
      return { path: 'M14,40 L86,16', focusX: 86, focusY: 16, startX: 14, startY: 40, label: '移动' };
    case 'crane':
      return { path: 'M20,50 C40,50 60,12 86,10', focusX: 86, focusY: 10, startX: 20, startY: 50, label: '升降' };
    case 'orbit':
      return { path: 'M20,40 A34,20 0 0 1 80,40', focusX: CX, focusY: CY, startX: 20, startY: 40, label: '环绕' };
    case 'handheld':
      return { path: 'M14,30 q8,-10 16,0 t16,0 t16,0 t16,0', focusX: 86, focusY: 30, startX: 14, startY: 30, label: '手持' };
    case 'static':
    default:
      return { path: `M${CX},${CY} l0,0`, focusX: CX, focusY: CY, startX: CX, startY: CY, label: '固定' };
  }
}
