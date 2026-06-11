/**
 * lib/vertical-composition (v10.6.0) — 竖屏(9:16)构图提示词模板(纯函数,可单测)。
 *
 * 背景:画幅参数(aspectRatio)只告诉引擎"出多大的图",不告诉它"怎么为竖屏构图"。
 * 横屏构图思维直接出 9:16 = 头脚被裁、主体贴边、字幕区被占。本模板把短剧行业的
 * 竖屏构图共识固化进分镜渲染 prompt:
 *   - 单主体居中(竖屏没有左右空间讲双人构图,对峙用前后景深而非并排)
 *   - 头部留白(顶部 ~10% 给平台状态栏/标题遮挡缓冲)
 *   - 主体落在中段安全带
 *   - 底部 ~20% 留空(烧入字幕 + 平台操作栏)
 * 仅 9:16 注入;其他画幅零改动(横屏零回归验收条款)。
 */

export const VERTICAL_ASPECT = '9:16';

const HINTS =
  'vertical 9:16 portrait composition, single subject centered, generous headroom at top, ' +
  'key subject within the middle safe band, keep bottom 20% visually clear for subtitles, ' +
  'depth layering instead of side-by-side staging, mobile-first short-drama framing';

/** 竖构图提示词片段(英文,与渲染 prompt 语言一致)。 */
export function verticalCompositionHints(): string {
  return HINTS;
}

/** 仅 9:16 时把竖构图模板拼进 prompt;其余画幅原样返回。 */
export function withVerticalHints(prompt: string, aspect: string | undefined): string {
  if (aspect !== VERTICAL_ASPECT) return prompt;
  return `${prompt}, ${HINTS}`;
}
