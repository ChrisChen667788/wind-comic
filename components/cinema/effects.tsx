'use client';

/**
 * Cinema 微动效组件 (v2.13.3, Aceternity 风格)
 *
 * 全用 framer-motion(已是项目依赖)+ 纯 CSS,无需新装包。
 *
 * 包含:
 *   <NumberTicker>      — 数字滚动到指定值(项目计数 / 评分等)
 *   <BorderBeam>        — 旋转的 amber 渐变边框光束(签名效果,用于 Slate / 主 CTA)
 *   <AnimatedShinyText> — 文字上的 amber 光波扫过(灵感库 / 提示)
 *   <Marquee>           — 横向无限滚动(灵感卡 / 案例库)
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useInView } from 'framer-motion';

// ────────────────────────────────────────────────
// NumberTicker — 滚到目标值
// ────────────────────────────────────────────────
export function NumberTicker({
  value,
  duration = 1.4,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-30% 0px' });
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, {
    damping: 28,
    stiffness: 80,
    duration: duration * 1000,
  });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (inView) motionVal.set(value);
  }, [inView, value, motionVal]);

  useEffect(() => {
    const unsub = spring.on('change', (latest) => {
      setDisplay(latest.toFixed(decimals));
    });
    return unsub;
  }, [spring, decimals]);

  return (
    <span ref={ref} className={`cinema-mono tabular-nums ${className}`}>
      {prefix}{display}{suffix}
    </span>
  );
}

// ────────────────────────────────────────────────
// BorderBeam — 旋转的边框光束
// ────────────────────────────────────────────────
export function BorderBeam({
  size = 200,
  duration = 8,
  delay = 0,
  colorFrom = 'rgba(201, 163, 94, 0.0)',
  colorTo = 'rgba(201, 163, 94, 0.85)',
}: {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        // 用 CSS 变量交给 keyframes 用
        ['--size' as any]: `${size}px`,
        ['--duration' as any]: `${duration}s`,
        ['--delay' as any]: `${delay}s`,
        ['--from' as any]: colorFrom,
        ['--to' as any]: colorTo,
      }}
    >
      <span
        className="absolute aspect-square"
        style={{
          width: 'var(--size)',
          background: 'transparent',
          backgroundImage:
            'conic-gradient(from 0deg, var(--from) 0deg, var(--to) 30deg, var(--from) 60deg)',
          mask: 'linear-gradient(black, black), linear-gradient(black, black)',
          maskComposite: 'exclude',
          padding: '1px',
          inset: 0,
          animation: 'cinema-beam-rotate var(--duration) linear var(--delay) infinite',
          offsetPath: 'rect(0px 100% 100% 0px round 4px)',
          offsetRotate: '0deg',
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────
// AnimatedShinyText — 文字光波扫过
// ────────────────────────────────────────────────
export function AnimatedShinyText({
  children,
  className = '',
  shimmerWidth = 100,
}: {
  children: ReactNode;
  className?: string;
  shimmerWidth?: number;
}) {
  return (
    <span
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: `linear-gradient(110deg,
          var(--cinema-text-2) 30%,
          var(--cinema-amber) 50%,
          var(--cinema-text-2) 70%
        )`,
        backgroundSize: `${shimmerWidth * 2}% 100%`,
        WebkitBackgroundClip: 'text',
        animation: 'cinema-shimmer 3.6s ease-in-out infinite',
      }}
    >
      {children}
    </span>
  );
}

// ────────────────────────────────────────────────
// Marquee — 横向无限滚动
// ────────────────────────────────────────────────
export function Marquee({
  children,
  speed = 30,
  pauseOnHover = true,
  className = '',
}: {
  children: ReactNode;
  speed?: number;
  pauseOnHover?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative flex overflow-hidden ${className}`}
      style={{ ['--marquee-speed' as any]: `${speed}s` }}
    >
      <motion.div
        className="flex shrink-0 gap-3"
        animate={{ x: ['0%', '-100%'] }}
        transition={{
          duration: speed,
          repeat: Infinity,
          ease: 'linear',
        }}
        whileHover={pauseOnHover ? { x: '0%' } : undefined}
      >
        {children}
        {children}
      </motion.div>
    </div>
  );
}
