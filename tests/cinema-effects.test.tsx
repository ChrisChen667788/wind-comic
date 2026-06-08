/**
 * Tests for components/cinema/effects.tsx (v2.13.4 additions)
 *
 * 锁住:
 *   - MovingBorderButton: render / 内层 children / disabled propagation
 *   - TextGenerateEffect: aria-label 是完整原文(SR 友好) + 中文逐字 / 英文成块
 *   - Spotlight: SVG 渲染 + position 切换 cx
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// jsdom 没有 SVG getTotalLength / getPointAtLength, framer-motion 在 useAnimationFrame
// 里调用会炸. 在 import 组件之前 stub 掉这两个 prototype 方法.
beforeAll(() => {
  // @ts-expect-error — jsdom 上 SVGGeometryElement 不存在, 直接挂在 SVGElement.prototype
  SVGElement.prototype.getTotalLength = function () { return 100; };
  // @ts-expect-error
  SVGElement.prototype.getPointAtLength = function () { return { x: 0, y: 0 }; };
});

import { MovingBorderButton, TextGenerateEffect, Spotlight } from '@/components/cinema/effects';

describe('MovingBorderButton', () => {
  it('renders children inside a real <button>', () => {
    render(<MovingBorderButton>开机 · ROLL</MovingBorderButton>);
    const btn = screen.getByRole('button', { name: /开机/ });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName.toLowerCase()).toBe('button');
  });

  it('forwards disabled prop and hides the moving highlight when disabled', () => {
    const { container } = render(<MovingBorderButton disabled>X</MovingBorderButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    // disabled 时不渲染那颗发光球
    const movingDot = container.querySelector('div[style*="radial-gradient"]');
    expect(movingDot).toBeNull();
  });

  it('renders the SVG path used for length sampling', () => {
    const { container } = render(<MovingBorderButton>X</MovingBorderButton>);
    const rect = container.querySelector('svg rect');
    expect(rect).toBeInTheDocument();
    expect(rect?.getAttribute('width')).toBe('100%');
  });

  it('forwards onClick (not blocked when enabled)', () => {
    const onClick = vi.fn();
    render(<MovingBorderButton onClick={onClick}>Click</MovingBorderButton>);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('TextGenerateEffect', () => {
  // v10.3.3 a11y: 完整原文改走 sr-only 真文本(aria-label 在无 role 的 span 上被 axe 禁止);
  // 可见的逐词/逐字动画 span 都 aria-hidden,故行为断言只看这些 aria-hidden 节点。
  const animatedText = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[aria-hidden="true"]'))
      .map((s) => s.textContent)
      .join('');

  it('exposes the full text via an sr-only node for screen readers', () => {
    render(<TextGenerateEffect text="从一句创意到完整短剧" />);
    expect(screen.getByText('从一句创意到完整短剧')).toBeInTheDocument();
  });

  it('splits Chinese characters one-by-one (each char becomes its own animated span)', () => {
    const { container } = render(<TextGenerateEffect text="影片" />);
    const animated = container.querySelectorAll('[aria-hidden="true"]');
    expect(animated.length).toBe(2); // 影 / 片 各一个动画 span
    expect(animatedText(container)).toBe('影片');
  });

  it('keeps English words as single chunks (not per-letter)', () => {
    const { container } = render(<TextGenerateEffect text="ROLL CAMERA" />);
    const animated = container.querySelectorAll('[aria-hidden="true"]');
    expect(animated.length).toBeLessThan(5); // 词块, 不是 11 个字母
    expect(animatedText(container)).toBe('ROLL CAMERA');
  });

  it('handles mixed CN+EN+space without losing characters', () => {
    const { container } = render(<TextGenerateEffect text="DIR · 老陈" />);
    expect(animatedText(container)).toBe('DIR · 老陈');
  });
});

describe('Spotlight', () => {
  it('renders an SVG with the right radialGradient cx for top-right (default)', () => {
    const { container } = render(<Spotlight />);
    const grad = container.querySelector('radialGradient');
    expect(grad).toBeInTheDocument();
    expect(grad?.getAttribute('cx')).toBe('82%');
  });

  it('switches cx to ~18% on top-left', () => {
    const { container } = render(<Spotlight position="top-left" />);
    const grad = container.querySelector('radialGradient');
    expect(grad?.getAttribute('cx')).toBe('18%');
  });

  it('uses cx=50% on top-center', () => {
    const { container } = render(<Spotlight position="top-center" />);
    const grad = container.querySelector('radialGradient');
    expect(grad?.getAttribute('cx')).toBe('50%');
  });

  it('uses pointer-events: none and aria-hidden so it never traps focus', () => {
    const { container } = render(<Spotlight />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain('pointer-events-none');
  });

  it('respects custom fill color', () => {
    const { container } = render(<Spotlight fill="rgba(0, 200, 100, 0.5)" />);
    const stop = container.querySelector('stop[offset="0%"]');
    expect(stop?.getAttribute('stop-color')).toBe('rgba(0, 200, 100, 0.5)');
  });
});
