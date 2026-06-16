/**
 * lib/cover-title-burn (v12.3.2) — 封面标题烧入(阶段二十二)。
 *
 * 此前封面标题只在浏览器端 CSS 叠层预览,下载的封面没标题。这里给 server 端 ffmpeg drawtext
 * 构建滤镜 + 解析 CJK 字体:把标题烧进定版封面的「标题安全区」(复用 getTitleSafeArea 几何)。
 * 纯函数(滤镜构建 + 字体候选)可单测;真烧入由 services/cover-title-service 跑 ffmpeg。
 * 无可用 CJK 字体 → 调用方跳过烧入、保留原封面(诚实降级,中文不烧成方块)。
 */
import type { TitleSafeArea } from './cover-candidates';

/** CJK 字体候选(env 优先 → macOS → 常见 Linux);返回路径列表,service 取首个存在的。 */
export function coverFontCandidates(): string[] {
  const env = process.env.COVER_FONT_FILE || process.env.SUBTITLE_FONT_FILE;
  return [
    ...(env ? [env] : []),
    '/System/Library/Fonts/PingFang.ttc',                    // macOS
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', // Debian/Ubuntu
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ];
}

/** drawtext 文本/路径转义(冒号、反斜杠、单引号在 ffmpeg filtergraph 里需转义)。 */
export function escapeDrawtextPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export interface CoverDrawtextOpts {
  width: number;
  height: number;
  safeArea: TitleSafeArea;
  fontFile: string;
  /** 标题文本写入的临时文件路径(用 textfile= 避开 text 转义地狱) */
  textfile: string;
}

/**
 * 构建封面标题 drawtext 滤镜(纯函数):
 *   字号随图高(~4.5%)、水平居中、置于安全区顶部、半透明底框 + 描边保可读。
 */
export function buildCoverDrawtext(opts: CoverDrawtextOpts): string {
  // 字号随(9:16 标准)图高 ~4.5%;y 用 ffmpeg `h` 表达式 → 不依赖实际分辨率也正确
  const fontSize = Math.max(18, Math.round(opts.height * 0.045));
  const boxPad = Math.max(8, Math.round(fontSize / 3));
  const parts = [
    `fontfile='${escapeDrawtextPath(opts.fontFile)}'`,
    `textfile='${escapeDrawtextPath(opts.textfile)}'`,
    'fontcolor=white',
    `fontsize=${fontSize}`,
    'box=1',
    'boxcolor=black@0.5',
    `boxborderw=${boxPad}`,
    'shadowcolor=black@0.6',
    'shadowx=2',
    'shadowy=2',
    'x=(w-text_w)/2',                       // 水平居中
    `y=(h*${opts.safeArea.topPct}/100)`,    // 安全区顶部(表达式,随实际图高)
  ];
  return `drawtext=${parts.join(':')}`;
}
