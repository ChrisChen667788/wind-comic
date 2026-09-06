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
