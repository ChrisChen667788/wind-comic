/**
 * lib/cinematography (v7.2) — 单镜头电影摄影规格 (对标 CineMaster/CineMatrix「单镜头精细化控制」)
 *
 * 纯逻辑 + 预设, 不打网络。把"景别 / 机位 / 镜头 / 运镜 / 焦点 / 氛围 / 运动强度"做成
 * 结构化、可枚举、可编译成 AI 提示词片段的规格 (ShotSpec), 给项目页每个分镜一套"驾驶舱控件"。
 *
 *   - compileShotSpecToPrompt(): 结构化参数 → 英文电影摄影 prompt 片段 (可拼到画面描述后)
 *   - describeShotSpec():        → 中文一行摘要 (chip 展示)
 *   - normalizeShotSpec():       从落库 data 安全解析 (前后兼容)
 *   - seedSpecFromCameraAngle(): 把历史的中文 cameraAngle (特写/俯拍…) 映射成默认 ShotSpec
 */

export type ShotSize = 'ELS' | 'WS' | 'LS' | 'MS' | 'CU' | 'ECU';
export type CameraAngle = 'eye' | 'low' | 'high' | 'dutch' | 'overhead';
export type LensId = '18' | '24' | '35' | '50' | '85' | '100' | 'anamorphic';
export type MovementId = 'static' | 'push-in' | 'pull-out' | 'pan' | 'tilt' | 'dolly' | 'crane' | 'handheld' | 'orbit';
export type FocusId = 'deep' | 'shallow' | 'rack' | 'soft';
export type AtmosphereId = 'clear' | 'rain' | 'fog' | 'smoke' | 'night' | 'neon' | 'dust' | 'snow';

export interface Preset<T extends string> {
  id: T;
  label: string;   // 中文
  short: string;   // 短标 (分段按钮)
  prompt: string;  // 英文 prompt 片段
}

export const SHOT_SIZES: Preset<ShotSize>[] = [
  { id: 'ELS', label: '超远景', short: 'ELS', prompt: 'extreme wide establishing shot' },
  { id: 'WS',  label: '远景',   short: 'WS',  prompt: 'wide shot' },
  { id: 'LS',  label: '全景',   short: 'LS',  prompt: 'full shot, full body in frame' },
  { id: 'MS',  label: '中景',   short: 'MS',  prompt: 'medium shot, waist up' },
  { id: 'CU',  label: '特写',   short: 'CU',  prompt: 'close up' },
  { id: 'ECU', label: '大特写', short: 'ECU', prompt: 'extreme close up, macro detail' },
];

export const CAMERA_ANGLES: Preset<CameraAngle>[] = [
  { id: 'eye',      label: '平视',   short: 'Eye',   prompt: 'eye-level angle' },
  { id: 'low',      label: '仰拍',   short: 'Low',   prompt: 'low angle looking up, heroic' },
  { id: 'high',     label: '俯拍',   short: 'High',  prompt: 'high angle looking down' },
  { id: 'dutch',    label: '荷兰角', short: 'Dutch', prompt: 'dutch tilt angle, tension' },
  { id: 'overhead', label: '顶拍',   short: 'Top',   prompt: 'overhead top-down birdseye angle' },
];

export const LENS_PRESETS: Preset<LensId>[] = [
  { id: '18',  label: '18mm 超广', short: '18mm',  prompt: '18mm ultra-wide lens, deep perspective' },
  { id: '24',  label: '24mm 广角', short: '24mm',  prompt: '24mm wide lens' },
  { id: '35',  label: '35mm 标准', short: '35mm',  prompt: '35mm lens, natural perspective' },
  { id: '50',  label: '50mm 标准', short: '50mm',  prompt: '50mm lens' },
  { id: '85',  label: '85mm 人像', short: '85mm',  prompt: '85mm portrait lens, compressed background' },
  { id: '100', label: '100mm 长焦', short: '100mm', prompt: '100mm telephoto lens, strong compression' },
  { id: 'anamorphic', label: '变形宽银幕', short: 'Anam', prompt: 'anamorphic lens, oval bokeh, horizontal flares, 2.39:1 feel' },
];

export const MOVEMENTS: Preset<MovementId>[] = [
  { id: 'static',   label: '固定',   short: 'Static',   prompt: 'locked-off static camera' },
  { id: 'push-in',  label: '推近',   short: 'Push In',  prompt: 'slow push-in toward subject' },
  { id: 'pull-out', label: '拉远',   short: 'Pull Out', prompt: 'smooth pull-out revealing environment' },
  { id: 'pan',      label: '横摇',   short: 'Pan',      prompt: 'horizontal pan' },
  { id: 'tilt',     label: '纵摇',   short: 'Tilt',     prompt: 'vertical tilt' },
  { id: 'dolly',    label: '移动',   short: 'Dolly',    prompt: 'lateral dolly move' },
  { id: 'crane',    label: '升降',   short: 'Crane',    prompt: 'crane move rising up' },
  { id: 'handheld', label: '手持',   short: 'Handheld', prompt: 'handheld with subtle organic shake' },
  { id: 'orbit',    label: '环绕',   short: 'Orbit',    prompt: 'arc orbit around subject' },
];

export const FOCUS_PRESETS: Preset<FocusId>[] = [
  { id: 'deep',    label: '深焦',     short: 'Deep',    prompt: 'deep focus, everything sharp' },
  { id: 'shallow', label: '浅景深',   short: 'Shallow', prompt: 'shallow depth of field, creamy bokeh' },
  { id: 'rack',    label: '变焦/移焦', short: 'Rack',    prompt: 'rack focus pull to the subject eyes' },
  { id: 'soft',    label: '柔焦',     short: 'Soft',    prompt: 'soft diffusion focus, dreamy' },
];

export const ATMOSPHERES: Preset<AtmosphereId>[] = [
  { id: 'clear', label: '通透', short: '通透', prompt: '' },
  { id: 'rain',  label: '雨',   short: '雨',   prompt: 'heavy rain, wet reflective surfaces' },
  { id: 'fog',   label: '雾',   short: '雾',   prompt: 'volumetric fog, atmospheric haze' },
  { id: 'smoke', label: '烟',   short: '烟',   prompt: 'drifting smoke, god rays' },
  { id: 'night', label: '夜',   short: '夜',   prompt: 'night scene, moody low-key lighting' },
  { id: 'neon',  label: '霓虹', short: '霓虹', prompt: 'neon-lit, colorful practical lights' },
  { id: 'dust',  label: '尘',   short: '尘',   prompt: 'dust particles in the air, backlit' },
  { id: 'snow',  label: '雪',   short: '雪',   prompt: 'falling snow, cold palette' },
];

export interface ShotSpec {
  shotSize: ShotSize;
  angle: CameraAngle;
  lens: LensId;
  movement: MovementId;
  focus: FocusId;
  atmosphere: AtmosphereId;
  /** 运动强度 0-100 (喂给视频模型的 motion 参数 / 提示语气) */
  motion: number;
}

export const DEFAULT_SHOT_SPEC: ShotSpec = {
  shotSize: 'MS', angle: 'eye', lens: '35', movement: 'push-in', focus: 'shallow', atmosphere: 'clear', motion: 35,
};

// ─── getters ───
const findP = <T extends string>(list: Preset<T>[], id: T) => list.find((p) => p.id === id);
export const getShotSize = (id: ShotSize) => findP(SHOT_SIZES, id);
export const getAngle = (id: CameraAngle) => findP(CAMERA_ANGLES, id);
export const getLens = (id: LensId) => findP(LENS_PRESETS, id);
export const getMovement = (id: MovementId) => findP(MOVEMENTS, id);
export const getFocus = (id: FocusId) => findP(FOCUS_PRESETS, id);
export const getAtmosphere = (id: AtmosphereId) => findP(ATMOSPHERES, id);

function clampMotion(n: any): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SHOT_SPEC.motion;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 把一个值校验进枚举, 不合法回落默认 */
function pick<T extends string>(list: Preset<T>[], v: any, fallback: T): T {
  return list.some((p) => p.id === v) ? (v as T) : fallback;
}

/** 从落库 data (任意形状) 安全解析 ShotSpec, 缺字段回落默认 */
export function normalizeShotSpec(raw: any): ShotSpec {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    shotSize: pick(SHOT_SIZES, r.shotSize, DEFAULT_SHOT_SPEC.shotSize),
    angle: pick(CAMERA_ANGLES, r.angle, DEFAULT_SHOT_SPEC.angle),
    lens: pick(LENS_PRESETS, r.lens, DEFAULT_SHOT_SPEC.lens),
    movement: pick(MOVEMENTS, r.movement, DEFAULT_SHOT_SPEC.movement),
    focus: pick(FOCUS_PRESETS, r.focus, DEFAULT_SHOT_SPEC.focus),
    atmosphere: pick(ATMOSPHERES, r.atmosphere, DEFAULT_SHOT_SPEC.atmosphere),
    motion: clampMotion(r.motion),
  };
}

/** 历史分镜只有中文 cameraAngle (特写/中景/俯拍/仰拍/跟拍…) → 映射成一个合理 ShotSpec 起点 */
export function seedSpecFromCameraAngle(cameraAngle?: string | null): ShotSpec {
  const a = (cameraAngle || '').trim();
  const sizeMap: Record<string, ShotSize> = {
    特写: 'CU', 大特写: 'ECU', 近景: 'MS', 中景: 'MS', 全景: 'LS', 远景: 'WS', 大远景: 'ELS',
  };
  const angleMap: Record<string, CameraAngle> = { 俯拍: 'high', 仰拍: 'low', 顶拍: 'overhead' };
  const spec: ShotSpec = { ...DEFAULT_SHOT_SPEC };
  if (sizeMap[a]) spec.shotSize = sizeMap[a];
  if (angleMap[a]) spec.angle = angleMap[a];
  if (a === '跟拍') spec.movement = 'dolly';
  if (a === '手持') { spec.movement = 'handheld'; spec.motion = 55; }
  return spec;
}

/** 结构化规格 → 英文电影摄影 prompt 片段 */
export function compileShotSpecToPrompt(spec: ShotSpec): string {
  const s = normalizeShotSpec(spec);
  const motionWord = s.motion >= 70 ? 'high motion energy' : s.motion <= 25 ? 'minimal calm motion' : 'moderate motion';
  const parts = [
    getShotSize(s.shotSize)?.prompt,
    getAngle(s.angle)?.prompt,
    getLens(s.lens)?.prompt,
    getMovement(s.movement)?.prompt,
    getFocus(s.focus)?.prompt,
    getAtmosphere(s.atmosphere)?.prompt,
    motionWord,
  ].filter((p): p is string => !!p && p.length > 0);
  return parts.join(', ');
}

/** 结构化规格 → 中文一行摘要 (chip) */
export function describeShotSpec(spec: ShotSpec): string {
  const s = normalizeShotSpec(spec);
  const bits = [
    getShotSize(s.shotSize)?.label,
    getAngle(s.angle)?.label,
    getLens(s.lens)?.short,
    getMovement(s.movement)?.label,
    getFocus(s.focus)?.label,
  ].filter(Boolean);
  const atmo = getAtmosphere(s.atmosphere);
  if (atmo && atmo.id !== 'clear') bits.push(atmo.label);
  return bits.join(' · ');
}
