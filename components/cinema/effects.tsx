'use client';

/**
 * Cinema 微动效组件 (v2.13.3 / v2.13.4, Aceternity 风格)
 *
 * 全用 framer-motion(已是项目依赖)+ 纯 CSS,无需新装包。
 *
 * 包含:
 *   <NumberTicker>        — 数字滚动到指定值(项目计数 / 评分等)
 *   <BorderBeam>          — 旋转的 amber 渐变边框光束(用于 Slate / 主 CTA)
 *   <AnimatedShinyText>   — 文字上的 amber 光波扫过(灵感库 / 提示)
 *   <Marquee>             — 横向无限滚动(灵感卡 / 案例库)
 *   <MovingBorderButton>  — v2.13.4 · 沿元素四周跑的 amber 高光,主 CTA 用
 *   <TextGenerateEffect>  — v2.13.4 · 词级别 stagger 显现,Slate 副标题用
 *   <Spotlight>           — v2.13.4 · SVG 锥光,Slate 顶部装饰
 */

import { useEffect, useRef, useState, useMemo, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { motion, useMotionValue, useSpring, useInView, useMotionTemplate, useAnimationFrame, useReducedMotion } from 'framer-motion';

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
  const reduce = useReducedMotion();
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, {
    damping: 28,
    stiffness: 80,
    duration: duration * 1000,
  });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (!inView) return;
    // v10.3.4 a11y: 数字弹簧非 transform/layout,MotionConfig 不会关 → 减少动效时直接落终值(不滚动)
    if (reduce) { setDisplay(value.toFixed(decimals)); return; }
    motionVal.set(value);
  }, [inView, value, motionVal, reduce, decimals]);

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
  const reduce = useReducedMotion();
  return (
    <div
      className={`relative flex overflow-hidden ${className}`}
      style={{ ['--marquee-speed' as any]: `${speed}s` }}
    >
      <motion.div
        className="flex shrink-0 gap-3"
        // v10.3.4 a11y: 减少动效时不滚动 —— 静止呈现首屏内容
        animate={reduce ? { x: '0%' } : { x: ['0%', '-100%'] }}
        transition={reduce ? { duration: 0 } : { duration: speed, repeat: Infinity, ease: 'linear' }}
        whileHover={!reduce && pauseOnHover ? { x: '0%' } : undefined}
      >
        {children}
        {children}
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────
// MovingBorderButton — Aceternity-style 主 CTA
//
// 沿四周跑的 amber 高光带 + 内置 button,用于"开机 / ROLL / 润色 / 生成视频"
// 这种"用户主路径终点"按钮。SVG <rect> 沿 stroke 路径取点,放一个发光球。
// ────────────────────────────────────────────────
export function MovingBorderButton({
  children,
  duration = 3500,
  borderRadius = 6,
  containerClassName = '',
  borderClassName = '',
  className = '',
  disabled,
  ...rest
}: {
  children: ReactNode;
  /** 高光绕一圈的毫秒数 */
  duration?: number;
  borderRadius?: number;
  containerClassName?: string;
  borderClassName?: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  // 高光的位置, framer 动画驱动
  const pathRef = useRef<SVGRectElement | null>(null);
  const progress = useMotionValue(0);
  const reduce = useReducedMotion();

  useAnimationFrame((time) => {
    // v10.3.4 a11y: 手动 rAF 不受 MotionConfig 管 → 减少动效时停跑边框高光
    if (disabled || reduce) return;
    const length = pathRef.current?.getTotalLength?.() ?? 0;
    if (length === 0) return;
    const pxPerMs = length / duration;
    const distance = (time * pxPerMs) % length;
    progress.set(distance);
  });

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  useEffect(() => {
    return progress.on('change', (v) => {
      const point = pathRef.current?.getPointAtLength?.(v);
      if (point) {
        x.set(point.x);
        y.set(point.y);
      }
    });
  }, [progress, x, y]);

  const transform = useMotionTemplate`translateX(${x}px) translateY(${y}px) translateX(-50%) translateY(-50%)`;

  return (
    <button
      disabled={disabled}
      className={`relative overflow-hidden rounded-md p-[1.5px] ${containerClassName}`}
      style={{ borderRadius }}
      {...rest}
    >
      {/* SVG 取点路径 (隐藏) */}
      <div className="absolute inset-0 pointer-events-none">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="absolute h-full w-full"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          <rect
            ref={pathRef}
            fill="none"
            width="100%"
            height="100%"
            rx={borderRadius}
            ry={borderRadius}
          />
        </svg>
        {!disabled && !reduce && (
          <motion.div
            className={`absolute top-0 left-0 h-12 w-12 ${borderClassName}`}
            style={{
              transform,
              background:
                'radial-gradient(rgba(201, 163, 94, 0.85) 0%, rgba(201, 163, 94, 0) 70%)',
            }}
          />
        )}
      </div>

      {/* 内层真正的按钮 surface */}
      <span
        className={`relative flex h-full w-full items-center justify-center ${className}`}
        style={{ borderRadius: borderRadius - 1 }}
      >
        {children}
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────
// TextGenerateEffect — 词级别 stagger 显现
//
// 把一段文本拆成词, in-view 后逐词淡入(类似 ChatGPT 流式打字感)。
// 不调 LLM, 纯前端动画, 适合 Slate notes / 引导文案。
// ────────────────────────────────────────────────
export function TextGenerateEffect({
  text,
  className = '',
  /** 单词淡入间隔 ms */
  stagger = 60,
  /** 单词显现时长 ms */
  duration = 320,
}: {
  text: string;
  className?: string;
  stagger?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduce = useReducedMotion();
  // 中文按字符切, 英文按空格切
  const words = useMemo(() => splitForReveal(text), [text]);

  return (
    <span ref={ref} className={className}>
      {/* v10.3.3 a11y: aria-label 不能用在无 role 的 span 上;改用 sr-only 真文本供读屏,动画词逐个 aria-hidden */}
      <span className="sr-only">{text}</span>
      {words.map((w, i) => (
        <motion.span
          key={`${i}-${w}`}
          // v10.3.4 a11y: 减少动效时一次性呈现(无 stagger / 位移 / 模糊)
          initial={reduce ? false : { opacity: 0, filter: 'blur(6px)', y: 4 }}
          animate={
            reduce
              ? { opacity: 1 }
              : inView
                ? { opacity: 1, filter: 'blur(0px)', y: 0 }
                : { opacity: 0, filter: 'blur(6px)', y: 4 }
          }
          transition={
            reduce
              ? { duration: 0 }
              : { duration: duration / 1000, delay: (i * stagger) / 1000, ease: [0.2, 0.8, 0.2, 1] }
          }
          aria-hidden="true"
          style={{ display: 'inline-block', whiteSpace: 'pre' }}
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

/** 中英文混合 stagger 切分:中文逐字, 英文按空格段, 标点跟在前面词后 */
function splitForReveal(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  for (const ch of text) {
    // 中文 / 日韩字符 — 逐字 (CJK Unified + Halfwidth/Fullwidth Forms + 中文标点)
    if (/[　-鿿＀-￯]/.test(ch)) {
      flush();
      out.push(ch);
    } else if (ch === ' ') {
      flush();
      out.push(' ');
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

// ────────────────────────────────────────────────
// Spotlight — Aceternity 风格的 SVG 锥光
//
// 用作 hero / Slate 卡片的背景装饰(右上 / 左上 默认右上)。
// 不影响布局, pointer-events:none, 父容器 relative + overflow-hidden。
// ────────────────────────────────────────────────
export function Spotlight({
  className = '',
  fill = 'rgba(201, 163, 94, 0.45)',
  position = 'top-right',
}: {
  className?: string;
  fill?: string;
  position?: 'top-right' | 'top-left' | 'top-center';
}) {
  // 椭圆中心的位置百分比
  const cx = position === 'top-left' ? 18 : position === 'top-center' ? 50 : 82;

  return (
    <svg
      className={`pointer-events-none absolute -top-12 z-0 h-[120%] w-full opacity-90 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient
          id={`cinema-spot-${position}`}
          cx={`${cx}%`}
          cy="0%"
          r="55%"
          fx={`${cx}%`}
          fy="0%"
        >
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <rect
        width="100"
        height="100"
        fill={`url(#cinema-spot-${position})`}
      />
    </svg>
  );
}
