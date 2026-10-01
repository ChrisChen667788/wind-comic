/**
 * lib/project-format (v7.4) — 项目级格式 / 色彩 / 帧率预设 (对标 CineFlow Director's Suite 顶栏)
 *
 * 纯逻辑 + 预设:色彩空间(ACES/LogC/Rec709…) · 帧率(24-120fps升格) · 安全框。
 *   - compileFormatPrompt(): → 生成提示词片段
 *   - describeFormat(): → 中文一行摘要
 *   - describeProjectAspect(): → 格式条上显示的画幅(取自 projects.aspect,见下)
 *
 * v12.464:**画幅不在这里**。v7.4 起这里有一份 `aspectId`(默认 Scope 2.39:1)和 `aspectRatioOf()`,
 * 但全仓没有任何生成代码读过它 —— 真正决定出片、分镜构图、导演台几何的是 v10.6.0 的 `projects.aspect`。
 * 结果是 9:16 项目的格式条写着「Scope 2.39:1」,改了也不生效。现在画幅只有 `projects.aspect` 一处,
 * 格式条只读显示它;旧资产里残留的 `aspectId` 在 normalize 时丢弃。
 */

import { normalizeVideoAspect } from './video-aspect';

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
  colorSpaceId: string;
  fps: number;
  /** 安全框叠层 (Title/Action Safe) */
  safeArea: boolean;
}

export const DEFAULT_PROJECT_FORMAT: ProjectFormat = {
  colorSpaceId: 'aces', fps: 24, safeArea: true,
};

export const getColorSpace = (id: string) => COLOR_SPACES.find((p) => p.id === id);

export function normalizeProjectFormat(raw: any): ProjectFormat {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    colorSpaceId: COLOR_SPACES.some((p) => p.id === r.colorSpaceId) ? r.colorSpaceId : DEFAULT_PROJECT_FORMAT.colorSpaceId,
    fps: (FRAME_RATES as readonly number[]).includes(Number(r.fps)) ? Number(r.fps) : DEFAULT_PROJECT_FORMAT.fps,
    safeArea: r.safeArea === undefined ? true : !!r.safeArea,
  };
}

/** 项目格式 → 生成提示词片段 (色彩 + 升格) */
export function compileFormatPrompt(f: ProjectFormat): string {
  const n = normalizeProjectFormat(f);
  const parts = [
    getColorSpace(n.colorSpaceId)?.prompt,
    n.fps >= 48 ? `${n.fps}fps high frame rate for slow motion` : `${n.fps}fps cinematic`,
  ].filter((p): p is string => !!p && p.length > 0);
  return parts.join(', ');
}

export function describeFormat(f: ProjectFormat): string {
  const n = normalizeProjectFormat(f);
  return [
    getColorSpace(n.colorSpaceId)?.label,
    `${n.fps}fps`,
    n.safeArea ? '安全框' : null,
  ].filter(Boolean).join(' · ');
}

const ASPECT_LABELS: Record<string, string> = { '9:16': '9:16 竖屏', '16:9': '16:9 横屏', '1:1': '1:1 方形' };

/**
 * v12.464:项目画幅(`projects.aspect`)→ 格式条上的显示。
 * 空值按库列默认 16:9(与详情接口同一口径)。`engineReady` = 视频引擎能原样出这个比例
 * (引擎只收 16:9 / 9:16 / 1:1,判定沿用 `normalizeVideoAspect`,不另立一份清单)。
 */
export function describeProjectAspect(aspect?: string | null): { ratio: string; label: string; engineReady: boolean } {
  const ratio = typeof aspect === 'string' && aspect.trim() ? aspect.trim() : '16:9';
  return { ratio, label: ASPECT_LABELS[ratio] ?? ratio, engineReady: normalizeVideoAspect(ratio) === ratio };
}
