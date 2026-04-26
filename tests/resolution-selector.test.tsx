/**
 * ResolutionSelector 组件测试 (v2.0 Sprint 0 D5)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ResolutionSelector,
  estimateCost,
} from '@/components/creation/ResolutionSelector';

describe('estimateCost', () => {
  it('360p 5s ≈ ¥0.25', () => {
    expect(estimateCost('360p', 5)).toBeCloseTo(0.25, 2);
  });
  it('480p 10s ≈ ¥1.2', () => {
    expect(estimateCost('480p', 10)).toBeCloseTo(1.2, 2);
  });
  it('720p 15s ≈ ¥3.3', () => {
    expect(estimateCost('720p', 15)).toBeCloseTo(3.3, 2);
  });
});

describe('ResolutionSelector', () => {
  const baseValue = { resolution: '720p' as const, aspectRatio: '16:9' as const };

  it('渲染 3 个分辨率档', () => {
    render(<ResolutionSelector value={baseValue} onChange={() => {}} />);
    expect(screen.getByTestId('resolution-tier-360p')).toBeInTheDocument();
    expect(screen.getByTestId('resolution-tier-480p')).toBeInTheDocument();
    expect(screen.getByTestId('resolution-tier-720p')).toBeInTheDocument();
  });

  it('不渲染 4K（本期决议）', () => {
    render(<ResolutionSelector value={baseValue} onChange={() => {}} />);
    expect(screen.queryByTestId('resolution-tier-1080p')).toBeNull();
    expect(screen.queryByText('4K')).toBeNull();
  });

  it('selected 状态正确', () => {
    render(<ResolutionSelector value={baseValue} onChange={() => {}} />);
    expect(
      screen.getByTestId('resolution-tier-720p').getAttribute('data-selected'),
    ).toBe('true');
    expect(
      screen.getByTestId('resolution-tier-480p').getAttribute('data-selected'),
    ).toBe('false');
  });

  it('点击分辨率触发 onChange 保留 aspectRatio', () => {
    const onChange = vi.fn();
    render(<ResolutionSelector value={baseValue} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('resolution-tier-480p'));
    expect(onChange).toHaveBeenCalledWith({
      resolution: '480p',
      aspectRatio: '16:9',
    });
  });

  it('点击 aspect ratio 触发 onChange 保留 resolution', () => {
    const onChange = vi.fn();
    render(<ResolutionSelector value={baseValue} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('aspect-9:16'));
    expect(onChange).toHaveBeenCalledWith({
      resolution: '720p',
      aspectRatio: '9:16',
    });
  });

  it('lockAspectRatio 时 aspect 按钮 disabled', () => {
    render(
      <ResolutionSelector
        value={baseValue}
        onChange={() => {}}
        lockAspectRatio
      />,
    );
    const btn = screen.getByTestId('aspect-9:16') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
