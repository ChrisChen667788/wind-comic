/**
 * Tests for components/cinema/dataviz.tsx (v2.13.4 additions)
 *
 * 锁住:
 *   - ScoreDonut: tier 配色 / 缺值兜底 / 中心读数 / aria-label
 *   - Sparkline (upgraded): trend auto color (rise=green / fall=red / flat=amber),
 *                           area path 包含, endpoints 渲染, domain 强制范围
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScoreDonut, Sparkline } from '@/components/cinema/dataviz';

describe('ScoreDonut — tier color', () => {
  it('renders an arc when score is provided', () => {
    const { container } = render(<ScoreDonut score={88} size={36} />);
    const circles = container.querySelectorAll('circle');
    // 1 base ring + 1 progress arc
    expect(circles.length).toBe(2);
    const arc = circles[1];
    expect(arc.getAttribute('stroke')).toBe('var(--cinema-green)');
  });

  it('uses amber for warn band (70-84)', () => {
    const { container } = render(<ScoreDonut score={75} />);
    const arc = container.querySelectorAll('circle')[1];
    expect(arc.getAttribute('stroke')).toBe('var(--cinema-amber)');
  });

  it('uses red for fail band (<70)', () => {
    const { container } = render(<ScoreDonut score={50} />);
    const arc = container.querySelectorAll('circle')[1];
    expect(arc.getAttribute('stroke')).toBe('var(--cinema-red)');
  });

  it('renders only the base ring (no arc) when score is null/undefined', () => {
    const { container } = render(<ScoreDonut score={null} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(1); // 只有底环
  });

  it('shows the rounded score in center by default', () => {
    const { getByText } = render(<ScoreDonut score={87.6} />);
    expect(getByText('88')).toBeInTheDocument();
  });

  it('shows em-dash when score missing', () => {
    const { getByText } = render(<ScoreDonut score={null} />);
    expect(getByText('—')).toBeInTheDocument();
  });

  it('omits center when showCenter=false', () => {
    const { container } = render(<ScoreDonut score={80} showCenter={false} />);
    expect(container.textContent).toBe('');
  });

  it('exposes aria-label', () => {
    const { container } = render(<ScoreDonut score={92} />);
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper?.getAttribute('aria-label')).toBe('Score 92');
  });

  it('aria-label "No score" when score missing', () => {
    const { container } = render(<ScoreDonut score={undefined} />);
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper?.getAttribute('aria-label')).toBe('No score');
  });

  it('clamps score over 100', () => {
    // 不应炸 (实际 stroke-dasharray 会被 0..1 clamp)
    const { container } = render(<ScoreDonut score={150} />);
    expect(container.querySelectorAll('circle').length).toBe(2);
  });
});

describe('Sparkline — trend color', () => {
  it('returns null when fewer than 2 values', () => {
    const { container } = render(<Sparkline values={[80]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('uses GREEN when last > first (rising trend)', () => {
    const { container } = render(<Sparkline values={[60, 70, 85]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('var(--cinema-green)');
  });

  it('uses RED when last < first (falling trend)', () => {
    const { container } = render(<Sparkline values={[85, 75, 60]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('var(--cinema-red)');
  });

  it('uses AMBER when first == last (flat)', () => {
    const { container } = render(<Sparkline values={[80, 75, 80]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('var(--cinema-amber)');
  });

  it('respects custom color override', () => {
    const { container } = render(<Sparkline values={[60, 90]} color="#ff00ff" />);
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('#ff00ff');
  });

  it('renders area gradient by default', () => {
    const { container } = render(<Sparkline values={[60, 70, 80]} />);
    const path = container.querySelector('path');
    expect(path).toBeInTheDocument();
    expect(path?.getAttribute('fill')).toMatch(/^url\(#cinema-spark-grad-/);
  });

  it('omits area when area=false', () => {
    const { container } = render(<Sparkline values={[60, 70, 80]} area={false} />);
    expect(container.querySelector('path')).toBeNull();
  });

  it('renders 2 endpoint circles by default', () => {
    const { container } = render(<Sparkline values={[60, 70, 80]} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('omits endpoint circles when endpoints=false', () => {
    const { container } = render(<Sparkline values={[60, 70, 80]} endpoints={false} />);
    expect(container.querySelectorAll('circle').length).toBe(0);
  });

  it('respects fixed domain — y range based on [0,100] not data', () => {
    // 当 domain 是 [0,100] 时, 60..80 在底部一段, 不会被拉伸到 height 顶
    const { container } = render(
      <Sparkline values={[60, 70, 80]} width={100} height={20} domain={[0, 100]} />,
    );
    const points = container.querySelector('polyline')?.getAttribute('points') || '';
    // 第一个点 y = height - (60-0)/100 * (height-2) - 1 = 20 - 11.4 - 1 ≈ 7.6
    // 最后一个点 y = 20 - 15.2 - 1 ≈ 3.8
    const ys = points.split(' ').map((p) => parseFloat(p.split(',')[1]));
    expect(ys[0]).toBeGreaterThan(7);
    expect(ys[ys.length - 1]).toBeLessThan(5);
  });
});
