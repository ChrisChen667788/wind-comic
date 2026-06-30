/**
 * 字幕风格预设(v12.52.0)。
 *
 * 调研开源「embedded-captions」技能(scene-embedded 动效字幕,10 种 identity)+ 短视频电商
 * 实践得出:**社媒/电商竖屏成片的字幕要更大、更粗、抬离底边**(避开平台 UI 和 CTA 区,
 * 提升可读性与转化)。本模块把字幕风格抽成预设,走 libass `force_style`(ffmpeg 原生、确定性、
 * 零新依赖),按题材/画幅选档。`clean` 与改造前的硬编码逐字符一致 → 旧链路零回归。
 */

export type CaptionPreset = 'clean' | 'social' | 'bold' | 'karaoke';

/**
 * 生成 libass force_style 串。
 *  - clean(默认):与旧版硬编码一致(FontSize=24,白字黑边,底部居中,MarginV=40)。
 *  - social(电商/广告短视频):大号 + 加粗 + 更厚描边 + 抬高(竖屏 MarginV 给 CTA/UI 留白)。
 *  - bold(强叙事/燃向):特大粗体 + 重描边、无阴影。
 */
export function buildCaptionForceStyle(
  preset: CaptionPreset,
  fontName: string,
  opts?: { vertical?: boolean },
): string {
  const vertical = !!opts?.vertical;
  switch (preset) {
    case 'social':
      return `FontName=${fontName},FontSize=${vertical ? 30 : 26},Bold=1,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00101010&,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=${vertical ? 120 : 56}`;
    case 'bold':
      return `FontName=${fontName},FontSize=${vertical ? 32 : 28},Bold=1,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00202020&,BorderStyle=1,Outline=4,Shadow=0,Alignment=2,MarginV=${vertical ? 100 : 48}`;
    case 'clean':
    default:
      return `FontName=${fontName},FontSize=24,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,Alignment=2,MarginV=40`;
  }
}

/** 按题材自动选字幕风格:商业题材 → karaoke(词级扫光,短视频质感最高);否则 clean(零回归)。
 *  v12.56.0:广告默认从 social 升级为 karaoke(逐字亮起,留存/质感更强)。 */
export function pickCaptionPreset(isCommercial: boolean): CaptionPreset {
  return isCommercial ? 'karaoke' : 'clean';
}
