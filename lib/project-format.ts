/**
 * lib/project-format (v7.4) — 项目级格式 / 色彩 / 帧率预设 (对标 CineFlow Director's Suite 顶栏)
 *
 * 纯逻辑 + 预设:画幅(IMAX/Scope/竖屏…) · 色彩空间(ACES/LogC/Rec709…) · 帧率(24-120fps升格) · 安全框。
 *   - compileFormatPrompt(): → 生成提示词片段 (画幅质感)
 *   - aspectRatioOf(): → 喂给生成接口的 '9:16' 字符串
 *   - describeFormat(): → 中文一行摘要
 */

export interface AspectPreset {
  id: string;
  label: string;     // IMAX 1.43:1
  ratio: string;     // 生成接口用 '16:9' / '9:16' / '2.39:1'
  prompt: string;    // 英文质感片段
}

export const FORMAT_PRESETS: AspectPreset[] = [
  { id: 'imax',     label: 'IMAX 1.43:1',  ratio: '1.43:1', prompt: 'IMAX 1.43:1 full-frame, immersive scale' },
  { id: 'scope',    label: 'Scope 2.39:1', ratio: '2.39:1', prompt: 'anamorphic cinemascope 2.39:1, ultra widescreen' },
  { id: 'flat',     label: 'Flat 1.85:1',  ratio: '1.85:1', prompt: 'theatrical flat 1.85:1' },
  { id: '16:9',     label: '16:9 横屏',    ratio: '16:9',   prompt: '16:9 widescreen' },
  { id: '9:16',     label: '9:16 竖屏',    ratio: '9:16',   prompt: '9:16 vertical for mobile' },
  { id: '1:1',      label: '1:1 方形',     ratio: '1:1',    prompt: '1:1 square' },
  { id: '4:3',      label: '4:3 经典',     ratio: '4:3',    prompt: '4:3 classic academy' },
  { id: '2.35:1',   label: '2.35:1',       ratio: '2.35:1', prompt: '2.35:1 widescreen' },
];

export interface ColorSpacePreset { id: string; label: string; prompt: string; }
export const COLOR_SPACES: ColorSpacePreset[] = [
  { id: 'aces',   label: 'ACES 1.3',   prompt: 'ACES color pipeline, filmic tonal range' },
  { id: 'logc4',  label: 'ARRI LogC4', prompt: 'ARRI LogC4 latitude' },
  { id: 'rec709', label: 'Rec.709',    prompt: 'Rec.709 broadcast color' },
  { id: 'p3',     label: 'DCI-P3',     prompt: 'DCI-P3 wide gamut' },
  { id: 'srgb',   label: 'sRGB',       prompt: 'sRGB standard color' },
];

export const FRAME_RATES = [24, 25, 30, 48, 60, 120] as const;

export interface ProjectFormat {
  aspectId: string;
  colorSpaceId: string;
  fps: number;
  /** 安全框叠层 (Title/Action Safe) */
  safeArea: boolean;
}

export const DEFAULT_PROJECT_FORMAT: ProjectFormat = {
  aspectId: 'scope', colorSpaceId: 'aces', fps: 24, safeArea: true,
};

export const getAspect = (id: string) => FORMAT_PRESETS.find((p) => p.id === id);
export const getColorSpace = (id: string) => COLOR_SPACES.find((p) => p.id === id);

export function normalizeProjectFormat(raw: any): ProjectFormat {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    aspectId: FORMAT_PRESETS.some((p) => p.id === r.aspectId) ? r.aspectId : DEFAULT_PROJECT_FORMAT.aspectId,
    colorSpaceId: COLOR_SPACES.some((p) => p.id === r.colorSpaceId) ? r.colorSpaceId : DEFAULT_PROJECT_FORMAT.colorSpaceId,
    fps: (FRAME_RATES as readonly number[]).includes(Number(r.fps)) ? Number(r.fps) : DEFAULT_PROJECT_FORMAT.fps,
    safeArea: r.safeArea === undefined ? true : !!r.safeArea,
  };
}

/** 喂给生成接口的画幅比例字符串 (如 '9:16') */
export function aspectRatioOf(f: ProjectFormat): string {
  return getAspect(normalizeProjectFormat(f).aspectId)?.ratio || '16:9';
}

/** 项目格式 → 生成提示词片段 (画幅质感 + 色彩 + 升格) */
export function compileFormatPrompt(f: ProjectFormat): string {
  const n = normalizeProjectFormat(f);
  const parts = [
    getAspect(n.aspectId)?.prompt,
    getColorSpace(n.colorSpaceId)?.prompt,
    n.fps >= 48 ? `${n.fps}fps high frame rate for slow motion` : `${n.fps}fps cinematic`,
  ].filter((p): p is string => !!p && p.length > 0);
  return parts.join(', ');
}

export function describeFormat(f: ProjectFormat): string {
  const n = normalizeProjectFormat(f);
  return [
    getAspect(n.aspectId)?.label,
    getColorSpace(n.colorSpaceId)?.label,
    `${n.fps}fps`,
    n.safeArea ? '安全框' : null,
  ].filter(Boolean).join(' · ');
}
