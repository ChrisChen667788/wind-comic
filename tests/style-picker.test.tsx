/**
 * StylePicker 组件测试 (v2.0 Sprint 0 D5)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StylePicker } from '@/components/creation/StylePicker';
import { STYLE_PRESETS } from '@/lib/style-presets';

describe('StylePicker', () => {
  it('默认渲染所有 60 个风格', () => {
    render(<StylePicker />);
    const grid = screen.getByTestId('style-grid');
    // 每个卡片 data-testid=style-card-<id>
    const cards = grid.querySelectorAll('[data-testid^="style-card-"]');
    expect(cards.length).toBe(STYLE_PRESETS.length);
    expect(cards.length).toBe(60);
  });

  it('点击 "动画" tab 只剩 12 个动画风格', () => {
    render(<StylePicker />);
    fireEvent.click(screen.getByTestId('style-tab-anime'));
    const cards = screen
      .getByTestId('style-grid')
      .querySelectorAll('[data-testid^="style-card-"]');
    expect(cards.length).toBe(12);
  });

  it('"热门" tab 只显示 popularity>=85 且不超过 24 个', () => {
    render(<StylePicker />);
    fireEvent.click(screen.getByTestId('style-tab-popular'));
    const cards = screen
      .getByTestId('style-grid')
      .querySelectorAll('[data-testid^="style-card-"]');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(24);
  });

  it('搜索过滤 —— 输入 "cinematic" 只保留匹配项', () => {
    render(<StylePicker />);
    fireEvent.change(screen.getByTestId('style-search'), {
      target: { value: 'cinematic' },
    });
    const cards = screen
      .getByTestId('style-grid')
      .querySelectorAll('[data-testid^="style-card-"]');
    expect(cards.length).toBeGreaterThan(0);
    // 第一个 cinematic 风格必须在其中
    expect(screen.getByTestId('style-card-cinematic')).toBeInTheDocument();
  });

  it('点击卡片触发 onChange', () => {
    const onChange = vi.fn();
    render(<StylePicker onChange={onChange} />);
    fireEvent.click(screen.getByTestId('style-card-cinematic'));
    expect(onChange).toHaveBeenCalledWith(
      'cinematic',
      expect.objectContaining({ id: 'cinematic' }),
    );
  });

  it('受控 value → 选中态正确', () => {
    render(<StylePicker value="cinematic" />);
    const card = screen.getByTestId('style-card-cinematic');
    expect(card.getAttribute('data-selected')).toBe('true');
  });

  it('clearable=true 时点击已选卡片会清空', () => {
    const onChange = vi.fn();
    render(<StylePicker value="cinematic" onChange={onChange} clearable />);
    fireEvent.click(screen.getByTestId('style-card-cinematic'));
    expect(onChange).toHaveBeenCalledWith('', expect.any(Object));
  });

  it('无匹配结果时显示空态', () => {
    render(<StylePicker />);
    fireEvent.change(screen.getByTestId('style-search'), {
      target: { value: 'xyz-zzz-no-match' },
    });
    expect(screen.getByText('没有找到匹配的风格')).toBeInTheDocument();
  });
});
