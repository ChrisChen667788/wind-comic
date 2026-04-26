/**
 * ModeCard / ModeCardGrid 测试 (v2.0 Sprint 0 D5)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ModeCard,
  ModeCardGrid,
  MODE_PRESETS,
  ALL_MODES,
} from '@/components/creation/ModeCard';

describe('MODE_PRESETS 配置', () => {
  it('5 种模式齐全（本期决议：不砍）', () => {
    expect(ALL_MODES).toHaveLength(5);
    expect(ALL_MODES).toEqual([
      'episodic',
      'mv',
      'quick',
      'comic-to-video',
      'ip-derivative',
    ]);
  });

  it('每种模式都有 icon / name / features / estMinutes', () => {
    for (const m of ALL_MODES) {
      const p = MODE_PRESETS[m];
      expect(p.icon).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.nameEn).toBeTruthy();
      expect(p.features.length).toBeGreaterThanOrEqual(2);
      expect(p.estMinutes).toBeTruthy();
    }
  });
});

describe('ModeCard', () => {
  it('渲染图标和名称', () => {
    render(<ModeCard preset={MODE_PRESETS.mv} />);
    expect(screen.getByText('MV 音乐视频')).toBeInTheDocument();
    expect(screen.getByText('🎵')).toBeInTheDocument();
  });

  it('selected 时 data-selected=true', () => {
    render(<ModeCard preset={MODE_PRESETS.mv} selected />);
    expect(
      screen.getByTestId('mode-card-mv').getAttribute('data-selected'),
    ).toBe('true');
  });

  it('点击触发 onSelect with mode', () => {
    const onSelect = vi.fn();
    render(<ModeCard preset={MODE_PRESETS.quick} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('mode-card-quick'));
    expect(onSelect).toHaveBeenCalledWith('quick');
  });
});

describe('ModeCardGrid', () => {
  it('渲染全部 5 张卡片', () => {
    render(<ModeCardGrid />);
    for (const m of ALL_MODES) {
      expect(screen.getByTestId(`mode-card-${m}`)).toBeInTheDocument();
    }
  });

  it('受控 value → 对应卡片 selected', () => {
    render(<ModeCardGrid value="episodic" />);
    expect(
      screen.getByTestId('mode-card-episodic').getAttribute('data-selected'),
    ).toBe('true');
    expect(
      screen.getByTestId('mode-card-mv').getAttribute('data-selected'),
    ).toBe('false');
  });

  it('点击触发 onChange', () => {
    const onChange = vi.fn();
    render(<ModeCardGrid onChange={onChange} />);
    fireEvent.click(screen.getByTestId('mode-card-ip-derivative'));
    expect(onChange).toHaveBeenCalledWith('ip-derivative');
  });
});
