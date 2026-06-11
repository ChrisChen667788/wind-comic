'use client';

/**
 * SafeAreaOverlay (v10.6.0) — 竖屏(9:16)字幕/平台 UI 安全区预览框。
 *
 * 叠在视频/分镜预览上(父容器需 relative),按主流竖屏平台(抖音/快手/TikTok)
 * 的遮挡习惯标三块危险区:
 *   - 顶部 ~10%:状态栏 + 标题/关注栏
 *   - 右侧 ~14%:点赞/评论/转发互动列
 *   - 底部 ~20%:字幕烧入区下沿 + 文案/操作栏
 * 中部即「安全带」。纯展示(pointer-events-none),aria-hidden(读屏无意义)。
 */
export function SafeAreaOverlay() {
  const zone = 'absolute border border-dashed border-[#E8C547]/70 bg-[#E8C547]/10';
  const label = 'absolute text-[9px] font-mono tracking-wider text-[#E8C547] bg-black/55 px-1 py-0.5 rounded';
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none z-10">
      {/* 顶部:状态栏/标题区 */}
      <div className={`${zone} top-0 left-0 right-0 h-[10%]`} />
      <span className={`${label} top-1 left-1`}>顶部 UI 区</span>
      {/* 右侧:互动列 */}
      <div className={`${zone} top-[10%] bottom-[20%] right-0 w-[14%]`} />
      <span className={`${label} top-[12%] right-1`}>互动列</span>
      {/* 底部:字幕 + 操作栏 */}
      <div className={`${zone} bottom-0 left-0 right-0 h-[20%]`} />
      <span className={`${label} bottom-1 left-1`}>字幕/操作区 · 主体勿入</span>
      {/* 中部安全带描边 */}
      <div className="absolute top-[10%] bottom-[20%] left-0 right-[14%] border border-emerald-400/50" />
      <span className={`${label} !text-emerald-300 top-[12%] left-1`}>安全带</span>
    </div>
  );
}
