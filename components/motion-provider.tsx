'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * v10.3.4 a11y: 全局 framer-motion 降级开关。
 * reducedMotion="user" —— 跟随系统「减少动态效果」设置:自动关闭所有 motion.* 的
 * transform / layout 动画(前庭敏感的位移/缩放/旋转),保留 opacity/颜色等无眩晕风险的过渡。
 * 注:它不管手动 useAnimationFrame、数字弹簧、自动播放视频 —— 那些在各组件内单独用
 * useReducedMotion() 兜底。
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
