/**
 * 素材展示框:框比例 + 填充方式的唯一出处(v12.425)。
 *
 * 为什么是 contain 而不是 cover —— 实测 99 张在库素材:
 *   character         896x1152(0.78) x38,但也有 1152x864(1.33) x2
 *   scene             1344x768(1.75) x27,也有 1152x864(1.33) x2
 *   storyboard        1344x768(1.75) x12 和 1152x864(1.33) x9,五五开
 *   storyboard-sketch 816x1456(0.56) x8,全是竖图
 * 同一类型内部比例就是混的 —— 任何写死的框配 object-cover 都必然裁掉素材。
 * 修前实测最狠一处:角色立绘 896x1152 被塞进 355x200 的框,裁掉 56%;
 * 场景 1344x768 塞进 542x180,裁掉 42%。用户只有点开全屏才看得到完整图。
 *
 * 框比例取该类型的「主导原生比例」,只为把留边压到最小;正确性由 contain 保证,
 * 不由框比例保证 —— 所以来一张异形素材也只是多点黑边,不会再丢画面。
 */

export type AssetFrameKind =
  | 'character'   // 角色立绘/转身图 —— 竖构图
  | 'scene'       // 场景概念图 —— 跟项目画幅
  | 'storyboard'  // 分镜 —— 跟项目画幅
  | 'sketch'      // 构图草图 —— 竖构图
  | 'video'       // 视频/首帧 —— 跟项目画幅
  | 'cover'       // 封面 —— 跟项目画幅
  | 'reference';  // 参考图/上传件 —— 形状完全不可控

/** 项目画幅:'9:16' 竖屏短剧,其余按 16:9。旧项目无该列 → 16:9,零回归。 */
export type ProjectAspect = string | null | undefined;

/** 素材媒体一律 contain:宁可留黑边,也不能让用户看不到自己生成的东西。 */
export const ASSET_MEDIA_FIT = 'object-contain';

/** 留边处的底色 —— 读起来像电影遮幅,而不是「图没加载出来」。 */
export const ASSET_MATTE_CLASS = 'bg-black';

export function projectFrameClass(aspect: ProjectAspect): string {
  return aspect === '9:16' ? 'aspect-[9/16]' : 'aspect-video';
}

export function frameClassFor(kind: AssetFrameKind, aspect?: ProjectAspect): string {
  switch (kind) {
    case 'character': return 'aspect-[7/9]';   // 主导 896x1152 = 7:9
    case 'sketch':    return 'aspect-[9/16]';  // 主导 816x1456 ≈ 9:16
    case 'reference': return 'aspect-square';  // 形状不可控,方框留边最匀
    default:          return projectFrameClass(aspect);
  }
}

/** 直接拼给 <img>/<video> 的 className。 */
export function assetMediaClass(kind: AssetFrameKind, aspect?: ProjectAspect): string {
  return `w-full ${frameClassFor(kind, aspect)} ${ASSET_MEDIA_FIT} ${ASSET_MATTE_CLASS}`;
}

/**
 * 给定框比例与素材原生尺寸,算 cover 会裁掉多少(0~1)。
 * 审计脚本和测试共用同一套算术 —— 别让门禁自己写一遍。
 */
export function coverCropRatio(boxAspect: number, naturalAspect: number): number {
  if (!(boxAspect > 0) || !(naturalAspect > 0)) return 0;
  return 1 - Math.min(boxAspect, naturalAspect) / Math.max(boxAspect, naturalAspect);
}

/**
 * 海报墙(v12.436)。
 *
 * 对标 Castloop 那种竖版海报墙:一屏扫几十个故事,卡片只有封面、标题、一行梗概。
 *
 * **墙面统一 9:16**。库里 32 个项目有 27 个是竖屏(84%),它们在 9:16 框里零裁切;
 * 修前列表写死 `h-[160px]` 横框,一张 9:16 的图放进去按实测框比 1.992 只看得见 28%。
 *
 * **填充方式按图片的真实比例决定,不信库里的 `aspect` 字段**:流水线可能给竖屏项目
 * 出了横图(那批项目的文件被清掉了,本机无法核对),按 aspect 一律 cover 就会把横图
 * 裁成一条竖缝。所以在图片加载后量 naturalWidth/Height 再定 —— 量的正是要紧的那个东西。
 *
 * 竖图(比例 ≤ 3:4)铺满;更宽的图 contain 并用同一张图模糊铺底,**绝不裁** ——
 * 守 v12.425 那条「缩略图和全屏看到的是同一张完整画面」。
 */
export const POSTER_FRAME_CLASS = 'aspect-[9/16]';

/** 比 3:4 还窄的图才铺满:此时 9:16 框最多从两侧裁掉 25%。 */
export const POSTER_COVER_MAX_AR = 0.75;

export type PosterFit = 'cover' | 'contain';

export function posterFitFor(naturalW: number, naturalH: number): PosterFit {
  if (!(naturalW > 0) || !(naturalH > 0)) return 'contain'; // 量不到就别裁
  return naturalW / naturalH <= POSTER_COVER_MAX_AR ? 'cover' : 'contain';
}

/** 给定比例的图在 9:16 框里能看到多少(0~1)。供测试与文档里的数字同源。 */
export function posterVisibleFraction(naturalW: number, naturalH: number): number {
  if (!(naturalW > 0) || !(naturalH > 0)) return 0;
  const src = naturalW / naturalH;
  const box = 9 / 16;
  if (posterFitFor(naturalW, naturalH) === 'contain') return 1; // contain 不丢像素
  return src > box ? box / src : src / box;
}
