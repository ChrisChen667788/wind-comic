/**
 * lib/project-format (v7.4) — 项目级格式 / 色彩 / 帧率预设 (对标 CineFlow Director's Suite 顶栏)
 *
 * 纯逻辑 + 预设:色彩空间(ACES/LogC/Rec709…) · 帧率(24-120fps升格) · 安全框。
 *   - withColorSpaceClause(): → 把色彩片段写进出图提示词(服务端注入口见 project-format-store)
 *   - describeFormat(): → 中文一行摘要
 *   - describeProjectAspect(): → 格式条上显示的画幅(取自 projects.aspect,见下)
 *
 * v12.466:三个字段各自的读者 ——
 *   - `fps`:EDL / AAF 导出、片段重拍(v12.456 起);
 *   - `colorSpaceId`:分镜出图提示词,唯一注入口 `withColorSpace()`(lib/project-format-store)。
 *     修前它只被 `compileFormatPrompt()` 编进片段,而那个函数全仓零调用;
 *   - `safeArea`:项目页分镜 / 视频预览上的竖屏安全区叠层(修前叠层只认页面里一个临时开关)。
 * 默认值改成「不指定 / 关」:没保存过格式的项目,出图与预览都和修前一样。
 *
 * v12.464:**画幅不在这里**。v7.4 起这里有一份 `aspectId`(默认 Scope 2.39:1)和 `aspectRatioOf()`,
 * 但全仓没有任何生成代码读过它 —— 真正决定出片、分镜构图、导演台几何的是 v10.6.0 的 `projects.aspect`。
 * 结果是 9:16 项目的格式条写着「Scope 2.39:1」,改了也不生效。现在画幅只有 `projects.aspect` 一处,
 * 格式条只读显示它;旧资产里残留的 `aspectId` 在 normalize 时丢弃。
 */

import { normalizeVideoAspect } from './video-aspect';

export interface ColorSpacePreset { id: string; label: string; prompt: string; }
export const COLOR_SPACES: ColorSpacePreset[] = [
  // v12.466:「不指定」= 出图提示词里不加任何色彩描述。默认就是它 —— 色彩接进出图之后,
  // 默认值若还是 ACES,每个点过「保存格式」(哪怕只改了帧率)的项目都会被悄悄改掉出图。
  { id: 'none',   label: '不指定',     prompt: '' },
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
  /** 竖屏安全区叠层(项目页分镜 / 视频预览;只有 9:16 有叠层) */
  safeArea: boolean;
}

export const DEFAULT_PROJECT_FORMAT: ProjectFormat = {
  colorSpaceId: 'none', fps: 24, safeArea: false,
};

export const getColorSpace = (id: string) => COLOR_SPACES.find((p) => p.id === id);

export function normalizeProjectFormat(raw: any): ProjectFormat {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    colorSpaceId: COLOR_SPACES.some((p) => p.id === r.colorSpaceId) ? r.colorSpaceId : DEFAULT_PROJECT_FORMAT.colorSpaceId,
    fps: (FRAME_RATES as readonly number[]).includes(Number(r.fps)) ? Number(r.fps) : DEFAULT_PROJECT_FORMAT.fps,
    safeArea: r.safeArea === undefined ? DEFAULT_PROJECT_FORMAT.safeArea : !!r.safeArea,
  };
}

/** 色彩片段的标记。重生时用户那句提示词常是上次落库的成品(已带色彩段),靠它认出来换掉。 */
const COLOR_MARK = '. Color: ';
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 只认预设里的原句 —— 用户自己写的 "Color:" 不会被误删 */
const COLOR_CLAUSE_RE = new RegExp(
  `${escapeRe(COLOR_MARK)}(?:${COLOR_SPACES.filter((p) => p.prompt).map((p) => escapeRe(p.prompt)).join('|')})`, 'g',
);

/**
 * v12.466:按项目色彩空间改写一句**出图**提示词。
 *
 * - 先删掉已有的色彩段(任何预设的),再写当前这一种 —— 改了色彩空间后整张重生,不会新旧两句并存;
 *   选「不指定」就只删不加。
 * - 写在第一个 ` --` 参数之前:`optimizeMidjourneyPrompt` 会在末尾追加 `--no text …`,
 *   落在参数后面的文字会被当成参数的一部分(v12.462 站位句踩过同一处)。
 * - 不碰帧率:一张静帧没有帧率,旧 `compileFormatPrompt` 往出图里写「120fps slow motion」是噪音。
 */
export function withColorSpaceClause(prompt: string, colorSpaceId: string | null | undefined): string {
  const base = (prompt || '').replace(COLOR_CLAUSE_RE, '');
  const clause = getColorSpace(normalizeProjectFormat({ colorSpaceId }).colorSpaceId)?.prompt;
  if (!clause) return base;
  const at = base.search(/\s--[a-z]/i);
  return at < 0 ? `${base}${COLOR_MARK}${clause}` : `${base.slice(0, at)}${COLOR_MARK}${clause}${base.slice(at)}`;
}

/**
 * v12.466:把页面里那份 `project-format` 资产换成刚保存的格式(没有就补一条)。
 * 这份资产有两个写入方 —— 格式条和「参数联动」—— 而页面只在加载时读一次。修前在一处保存后不刷新就去另一处同步,
 * 会把旧格式整份写回去;色彩现在进分镜出图,写回去就是静默改了出图。两边保存后都过这里,切页签时另一边读到的就是新值。
 */
export function withFormatAsset<T extends { type?: string }>(assets: T[], format: ProjectFormat): T[] {
  const data = normalizeProjectFormat(format);
  return assets.some((a) => a.type === 'project-format')
    ? assets.map((a) => (a.type === 'project-format' ? { ...a, data } : a))
    : [...assets, { id: 'project-format', type: 'project-format', name: 'project-format', data } as unknown as T];
}

export function describeFormat(f: ProjectFormat): string {
  const n = normalizeProjectFormat(f);
  return [
    n.colorSpaceId === 'none' ? null : getColorSpace(n.colorSpaceId)?.label,
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
