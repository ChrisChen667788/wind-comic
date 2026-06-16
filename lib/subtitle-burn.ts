/**
 * v3.5 — 字幕烧录平台预设.
 *
 * 不同平台的"爆款字幕"风格不一样: 抖音大白字粗黑边居中偏下, 小红书细字暖色,
 * YouTube 规矩白字黑底. 这文件把这些固化成预设, 生成 ffmpeg `subtitles` 滤镜的
 * `force_style` 串, 一键烧录.
 *
 * 纯函数, 单测: tests/v3-5-subtitle-burn.test.ts.
 */

export type SubtitlePlatform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'youtube' | 'tiktok' | 'default';

export interface SubtitleStyle {
  /** 字体名 (系统需装, 否则 ffmpeg 回退默认). */
  fontName: string;
  /** 字号 (基于 1080p, ffmpeg 按 PlayResY 缩放). */
  fontSize: number;
  /** 主色, ASS BGR hex `&HBBGGRR`. */
  primaryColour: string;
  /** 描边色. */
  outlineColour: string;
  /** 描边粗细 px. */
  outline: number;
  /** 阴影 px. */
  shadow: number;
  /** 底部边距 px. */
  marginV: number;
  /** ASS 对齐 (numpad: 2=底中, 5=正中, 8=顶中). */
  alignment: number;
  /** 是否加粗 (-1 = 是, 0 = 否, ASS 约定). */
  bold: number;
}

const PRESETS: Record<SubtitlePlatform, SubtitleStyle> = {
  // 抖音: 大白字 + 粗黑边 + 居中偏下, 信息密度高也看得清
  douyin: {
    fontName: 'PingFang SC', fontSize: 56, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 4, shadow: 1, marginV: 120, alignment: 2, bold: -1,
  },
  // 快手: 比抖音更大更粗, 下沉一点
  kuaishou: {
    fontName: 'PingFang SC', fontSize: 60, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 5, shadow: 1, marginV: 140, alignment: 2, bold: -1,
  },
  // 小红书: 细一点, 暖白, 描边淡, 偏精致
  xiaohongshu: {
    fontName: 'PingFang SC', fontSize: 48, primaryColour: '&H00F0F8FF',
    outlineColour: '&H00404040', outline: 2, shadow: 0, marginV: 160, alignment: 2, bold: 0,
  },
  // YouTube: 规矩白字黑描边, 字号适中
  youtube: {
    fontName: 'Arial', fontSize: 44, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 3, shadow: 1, marginV: 60, alignment: 2, bold: 0,
  },
  // TikTok: 竖屏大白字粗描边, 上抬避开右侧操作栏/底部话题, 与抖音同源略瘦
  tiktok: {
    fontName: 'Arial', fontSize: 52, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 4, shadow: 1, marginV: 180, alignment: 2, bold: -1,
  },
  default: {
    fontName: 'PingFang SC', fontSize: 50, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 3, shadow: 1, marginV: 100, alignment: 2, bold: 0,
  },
};

export function listSubtitlePlatforms(): SubtitlePlatform[] {
  return Object.keys(PRESETS) as SubtitlePlatform[];
}

/** 取平台预设. 未知平台回退 default. 返回拷贝, 防外部 mutate. */
export function getSubtitleStyle(platform: SubtitlePlatform | string): SubtitleStyle {
  const p = (PRESETS as Record<string, SubtitleStyle>)[platform];
  return { ...(p ?? PRESETS.default) };
}

/** 允许在预设基础上覆盖个别字段. */
export function getSubtitleStyleWithOverrides(
  platform: SubtitlePlatform | string,
  overrides: Partial<SubtitleStyle> = {},
): SubtitleStyle {
  return { ...getSubtitleStyle(platform), ...overrides };
}

/** SubtitleStyle → ASS force_style 串 (逗号分隔 K=V). */
export function styleToForceStyle(style: SubtitleStyle): string {
  const pairs: Array<[string, string | number]> = [
    ['FontName', style.fontName],
    ['FontSize', style.fontSize],
    ['PrimaryColour', style.primaryColour],
    ['OutlineColour', style.outlineColour],
    ['Outline', style.outline],
    ['Shadow', style.shadow],
    ['MarginV', style.marginV],
    ['Alignment', style.alignment],
    ['Bold', style.bold],
  ];
  return pairs.map(([k, v]) => `${k}=${v}`).join(',');
}

/** ffmpeg path 转义 — `:` `'` `\` 在 filtergraph 里有特殊含义, 要转义. */
export function escapeSubtitlePath(p: string): string {
  // filtergraph: 反斜杠先转, 再转冒号 (Windows 盘符) 和单引号
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * 生成完整的 `-vf subtitles=...` 滤镜串.
 * @param srtOrAssPath 字幕文件路径 (.srt / .ass)
 * @param platform 平台预设
 * @param overrides 覆盖字段
 */
export function buildSubtitlesFilter(
  srtOrAssPath: string,
  platform: SubtitlePlatform | string = 'default',
  overrides: Partial<SubtitleStyle> = {},
): string {
  if (!srtOrAssPath) throw new Error('buildSubtitlesFilter: empty subtitle path');
  const style = getSubtitleStyleWithOverrides(platform, overrides);
  const force = styleToForceStyle(style);
  const escaped = escapeSubtitlePath(srtOrAssPath);
  return `subtitles='${escaped}':force_style='${force}'`;
}
