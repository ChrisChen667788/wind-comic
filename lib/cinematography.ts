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

// ─────────────────────────────────────────────────────────────
// v7.4 结构化光影设计 (对标 CineFlow/CineMatrix「灯光与氛围」)
// ─────────────────────────────────────────────────────────────
export type LightingSetupId =
  | 'natural' | 'high-key' | 'low-key' | 'rembrandt' | 'rim' | 'neon-noir' | 'golden-hour' | 'top-down' | 'silhouette';
export type ContrastLevel = 'low' | 'medium' | 'high';

export const LIGHTING_SETUPS: Preset<LightingSetupId>[] = [
  { id: 'natural',     label: '自然光',   short: '自然',   prompt: 'naturalistic motivated lighting' },
  { id: 'high-key',    label: '高调',     short: '高调',   prompt: 'high-key lighting, bright and even, minimal shadows' },
  { id: 'low-key',     label: '低调',     short: '低调',   prompt: 'low-key lighting, deep shadows, chiaroscuro' },
  { id: 'rembrandt',   label: '伦勃朗光', short: '伦勃朗', prompt: 'Rembrandt lighting, triangle cheek highlight' },
  { id: 'rim',         label: '轮廓光',   short: '轮廓',   prompt: 'strong rim back light separating subject from background' },
  { id: 'neon-noir',   label: '霓虹黑色', short: '霓虹',   prompt: 'neon noir lighting, colored practical lights, hard shadows' },
  { id: 'golden-hour', label: '黄金时刻', short: '黄金',   prompt: 'golden hour warm directional sunlight, long shadows' },
  { id: 'top-down',    label: '顶光',     short: '顶光',   prompt: 'hard top-down key light, dramatic eye shadows' },
  { id: 'silhouette',  label: '剪影',     short: '剪影',   prompt: 'backlit silhouette, subject mostly in shadow' },
];

export const CONTRAST_LEVELS: { id: ContrastLevel; label: string; prompt: string }[] = [
  { id: 'low',    label: '低反差', prompt: 'low contrast, soft gradation' },
  { id: 'medium', label: '中反差', prompt: '' },
  { id: 'high',   label: '高反差', prompt: 'high contrast, crushed blacks' },
];

/** 色温预设 (开尔文) → 冷暖描述 */
export const COLOR_TEMPS: { k: number; label: string; word: string }[] = [
  { k: 2800, label: '2800K 暖',   word: 'very warm tungsten color temperature' },
  { k: 3200, label: '3200K 暖白', word: 'warm tungsten color temperature' },
  { k: 4300, label: '4300K 中性', word: 'neutral white balance' },
  { k: 5600, label: '5600K 日光', word: 'cool daylight color temperature' },
  { k: 6500, label: '6500K 冷',   word: 'cold blue daylight color temperature' },
];

export interface LightingSpec { setup: LightingSetupId; keyTempK: number; contrast: ContrastLevel; }
export const DEFAULT_LIGHTING: LightingSpec = { setup: 'natural', keyTempK: 5600, contrast: 'medium' };

// ─────────────────────────────────────────────────────────────
// v7.4 摄影机 / 镜头模拟 (对标 CineFlow「摄影机系统」)
// ─────────────────────────────────────────────────────────────
export type CameraBodyId = 'alexa65' | 'alexa-mini-lf' | 'red-raptor' | 'venice2' | 'bmpcc';
export type LensSeriesId = 'panavision-c' | 'cooke-s7' | 'zeiss-supreme' | 'master-prime' | 'vintage';

export const CAMERA_BODIES: Preset<CameraBodyId>[] = [
  { id: 'alexa65',       label: 'ARRI Alexa 65',      short: 'Alexa 65', prompt: 'shot on ARRI Alexa 65, large format, filmic latitude' },
  { id: 'alexa-mini-lf', label: 'ARRI Alexa Mini LF', short: 'Mini LF',  prompt: 'shot on ARRI Alexa Mini LF' },
  { id: 'red-raptor',    label: 'RED V-Raptor',       short: 'V-Raptor', prompt: 'shot on RED V-Raptor, crisp high resolution' },
  { id: 'venice2',       label: 'Sony Venice 2',      short: 'Venice 2', prompt: 'shot on Sony Venice 2, rich color science' },
  { id: 'bmpcc',         label: 'Blackmagic',         short: 'BMPCC',    prompt: 'shot on Blackmagic cinema camera' },
];

export const LENS_SERIES: Preset<LensSeriesId>[] = [
  { id: 'panavision-c',  label: 'Panavision C 变形', short: 'Pana C', prompt: 'Panavision C-series anamorphic, oval bokeh, blue horizontal lens flares' },
  { id: 'cooke-s7',      label: 'Cooke S7',          short: 'Cooke',  prompt: 'Cooke S7 spherical, warm Cooke-look skin tones' },
  { id: 'zeiss-supreme', label: 'Zeiss Supreme',     short: 'Zeiss',  prompt: 'Zeiss Supreme Prime, clean neutral rendering' },
  { id: 'master-prime',  label: 'Master Prime',      short: 'Master', prompt: 'ARRI Master Prime, sharp high-contrast rendering' },
  { id: 'vintage',       label: '复古老镜',          short: '复古',   prompt: 'vintage uncoated lens, soft low-contrast glow' },
];

export const T_STOPS = [1.3, 1.4, 2, 2.8, 4, 5.6, 8] as const;
export const ISO_OPTIONS = [200, 400, 800, 1600, 3200] as const;
export const ND_OPTIONS = ['none', '0.3', '0.6', '0.9', '1.2'] as const;
export const WB_PRESETS = [3200, 4300, 5600, 6500] as const;

export interface CameraSimSpec {
  body: CameraBodyId;
  lensSeries: LensSeriesId;
  tStop: number;
  iso: number;
  nd: string;
  wb: number;
}
export const DEFAULT_CAMERA: CameraSimSpec = { body: 'alexa-mini-lf', lensSeries: 'zeiss-supreme', tStop: 2.8, iso: 800, nd: 'none', wb: 5600 };

export interface ShotSpec {
  shotSize: ShotSize;
  angle: CameraAngle;
  lens: LensId;
  movement: MovementId;
  focus: FocusId;
  atmosphere: AtmosphereId;
  /** 运动强度 0-100 (喂给视频模型的 motion 参数 / 提示语气) */
  motion: number;
  /** v7.4 结构化光影 */
  lighting: LightingSpec;
  /** v7.4 摄影机/镜头模拟 */
  camera: CameraSimSpec;
}

export const DEFAULT_SHOT_SPEC: ShotSpec = {
  shotSize: 'MS', angle: 'eye', lens: '35', movement: 'push-in', focus: 'shallow', atmosphere: 'clear', motion: 35,
  lighting: DEFAULT_LIGHTING, camera: DEFAULT_CAMERA,
};

// ─── getters ───
const findP = <T extends string>(list: Preset<T>[], id: T) => list.find((p) => p.id === id);
export const getShotSize = (id: ShotSize) => findP(SHOT_SIZES, id);
export const getAngle = (id: CameraAngle) => findP(CAMERA_ANGLES, id);
export const getLens = (id: LensId) => findP(LENS_PRESETS, id);
export const getMovement = (id: MovementId) => findP(MOVEMENTS, id);
export const getFocus = (id: FocusId) => findP(FOCUS_PRESETS, id);
export const getAtmosphere = (id: AtmosphereId) => findP(ATMOSPHERES, id);
export const getLightingSetup = (id: LightingSetupId) => findP(LIGHTING_SETUPS, id);
export const getCameraBody = (id: CameraBodyId) => findP(CAMERA_BODIES, id);
export const getLensSeries = (id: LensSeriesId) => findP(LENS_SERIES, id);

/** 最接近的色温预设描述词 */
export function colorTempWord(k: number): string {
  let best = COLOR_TEMPS[0];
  for (const c of COLOR_TEMPS) if (Math.abs(c.k - k) < Math.abs(best.k - k)) best = c;
  return best.word;
}

function clampMotion(n: any): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SHOT_SPEC.motion;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 把一个值校验进枚举, 不合法回落默认 */
function pick<T extends string>(list: Preset<T>[], v: any, fallback: T): T {
  return list.some((p) => p.id === v) ? (v as T) : fallback;
}

function inNums(list: readonly number[], v: any, fb: number): number {
  return list.includes(Number(v)) ? Number(v) : fb;
}

function normalizeLighting(raw: any): LightingSpec {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    setup: pick(LIGHTING_SETUPS, r.setup, DEFAULT_LIGHTING.setup),
    keyTempK: inNums(COLOR_TEMPS.map((c) => c.k), r.keyTempK, DEFAULT_LIGHTING.keyTempK),
    contrast: (['low', 'medium', 'high'] as ContrastLevel[]).includes(r.contrast) ? r.contrast : DEFAULT_LIGHTING.contrast,
  };
}

function normalizeCamera(raw: any): CameraSimSpec {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    body: pick(CAMERA_BODIES, r.body, DEFAULT_CAMERA.body),
    lensSeries: pick(LENS_SERIES, r.lensSeries, DEFAULT_CAMERA.lensSeries),
    tStop: inNums(T_STOPS, r.tStop, DEFAULT_CAMERA.tStop),
    iso: inNums(ISO_OPTIONS, r.iso, DEFAULT_CAMERA.iso),
    nd: (ND_OPTIONS as readonly string[]).includes(r.nd) ? r.nd : DEFAULT_CAMERA.nd,
    wb: inNums(WB_PRESETS, r.wb, DEFAULT_CAMERA.wb),
  };
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
    lighting: normalizeLighting(r.lighting),
    camera: normalizeCamera(r.camera),
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

/** 结构化规格 → 英文电影摄影 prompt 片段 (含光影 + 摄影机模拟) */
export function compileShotSpecToPrompt(spec: ShotSpec): string {
  const s = normalizeShotSpec(spec);
  const motionWord = s.motion >= 70 ? 'high motion energy' : s.motion <= 25 ? 'minimal calm motion' : 'moderate motion';
  const contrast = CONTRAST_LEVELS.find((c) => c.id === s.lighting.contrast)?.prompt;
  const ndPart = s.camera.nd !== 'none' ? `ND ${s.camera.nd}` : '';
  const parts = [
    getShotSize(s.shotSize)?.prompt,
    getAngle(s.angle)?.prompt,
    getLens(s.lens)?.prompt,
    getMovement(s.movement)?.prompt,
    getFocus(s.focus)?.prompt,
    getAtmosphere(s.atmosphere)?.prompt,
    // 光影
    getLightingSetup(s.lighting.setup)?.prompt,
    colorTempWord(s.lighting.keyTempK),
    contrast,
    // 摄影机/镜头模拟
    getCameraBody(s.camera.body)?.prompt,
    getLensSeries(s.camera.lensSeries)?.prompt,
    `T-stop ${s.camera.tStop}`,
    `ISO ${s.camera.iso}`,
    ndPart,
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
  if (s.lighting.setup !== 'natural') bits.push(getLightingSetup(s.lighting.setup)?.short || '');
  return bits.filter(Boolean).join(' · ');
}
