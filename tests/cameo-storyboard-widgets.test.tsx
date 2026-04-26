/**
 * CameoStoryboardWidgets 单测 · Sprint A.4 (v2.12)
 *
 * 锁住分镜 tab 仪表盘的关键渲染契约:
 *   · CameoBadge:  分数 → 颜色档位 / null 数据不渲染 / 多角色 popover 画 per-char 条
 *   · CameoSummary: avg / lowCount / batch retry button 显示逻辑
 *
 * 这些 UI 是用户最常看的"镜头一致性"页面;改了行为用户能立刻看出来,必须有 lock。
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { CameoBadge, CameoSummary } from '@/components/cameo/CameoStoryboardWidgets';

describe('CameoBadge — score → color band', () => {
  it('renders no badge when there is no score and no retry mark', () => {
    const { container } = render(<CameoBadge data={{}} />);
    // no button, no popover root
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders score 90 in green band', () => {
    render(<CameoBadge data={{ cameoScore: 90 }} />);
    const btn = screen.getByRole('button', { name: /Cameo 一致性: 90\/100/ });
    expect(btn).toHaveClass(/emerald|green/i);
    expect(btn.textContent).toContain('90');
  });

  it('renders score 75 in amber band (between 70 and 84)', () => {
    render(<CameoBadge data={{ cameoScore: 75 }} />);
    const btn = screen.getByRole('button', { name: /Cameo 一致性: 75\/100/ });
    expect(btn).toHaveClass(/amber/i);
  });

  it('renders score 60 in red band', () => {
    render(<CameoBadge data={{ cameoScore: 60 }} />);
    const btn = screen.getByRole('button', { name: /Cameo 一致性: 60\/100/ });
    expect(btn).toHaveClass(/rose|red/i);
  });
});

describe('CameoBadge popover — single-character baseline', () => {
  it('hides the per-character section when only 1 score entry', () => {
    render(<CameoBadge data={{
      cameoScore: 80,
      cameoPerCharacterScores: [{ name: '李长安', score: 80, reasoning: 'fine' }],
    }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cameo 一致性/ }));
    // popover open
    expect(screen.getByText(/首次生成达标|已自动重生/)).toBeInTheDocument();
    // per-char header should NOT appear (single char doesn't need breakdown)
    expect(screen.queryByText(/per-character/i)).toBeNull();
  });

  it('shows reasoning quote when present', () => {
    render(<CameoBadge data={{ cameoScore: 60, cameoReason: '左脸偏离参考 15%' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cameo 一致性/ }));
    expect(screen.getByText(/左脸偏离参考 15%/)).toBeInTheDocument();
  });

  it('shows retry summary line when retried', () => {
    render(<CameoBadge data={{ cameoScore: 88, cameoRetried: true, cameoAttempts: 2, cameoFinalCw: 125 }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cameo 一致性/ }));
    expect(screen.getByText(/已自动重生 2 次/)).toBeInTheDocument();
    expect(screen.getByText(/最终 cw = 125/)).toBeInTheDocument();
  });
});

describe('CameoBadge popover — multi-character (Phase 3 → A.4)', () => {
  it('renders per-character bars when 2+ scores present', () => {
    render(<CameoBadge data={{
      cameoScore: 60, // min of all
      cameoPerCharacterScores: [
        { name: '李长安', score: 90 },
        { name: '柳如烟', score: 60 },
        { name: '混混',   score: 75 },
      ],
    }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cameo 一致性/ }));
    expect(screen.getByText(/per-character \(3\)/i)).toBeInTheDocument();
    expect(screen.getByText('李长安')).toBeInTheDocument();
    expect(screen.getByText('柳如烟')).toBeInTheDocument();
    expect(screen.getByText('混混')).toBeInTheDocument();
    // top-level shows the min (60) — separately, the per-char list also shows 90 / 60 / 75
    expect(screen.getAllByText(/^90$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^75$/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders a dash for null score (vision-failed character)', () => {
    render(<CameoBadge data={{
      cameoScore: 80,
      cameoPerCharacterScores: [
        { name: 'A', score: 80 },
        { name: 'B', score: null },
      ],
    }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cameo 一致性/ }));
    // Dash for null
    expect(screen.getByText('B')).toBeInTheDocument();
    // The score column for B should be a long dash; we can find it inside the per-char list
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to "#i" when name is missing', () => {
    render(<CameoBadge data={{
      cameoScore: 70,
      cameoPerCharacterScores: [{ score: 80 }, { score: 70 }],
    }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cameo 一致性/ }));
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });
});

describe('CameoSummary — stats + batch retry button', () => {
  const sb = (shotNumber: number, score?: number, retried = false) => ({
    shotNumber,
    data: score == null ? {} : { cameoScore: score, cameoRetried: retried },
  });

  it('renders nothing when no shots and no scores', () => {
    const { container } = render(<CameoSummary storyboards={[]} onBatchRetry={() => {}} batchRetrying={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the legacy-data note when shots exist but none scored', () => {
    render(<CameoSummary
      storyboards={[sb(1), sb(2)]}
      onBatchRetry={() => {}}
      batchRetrying={false}
    />);
    expect(screen.getByText(/暂无 Cameo 一致性评分/)).toBeInTheDocument();
  });

  it('computes avg + lowCount + retriedCount correctly', () => {
    render(<CameoSummary
      storyboards={[
        sb(1, 90),
        sb(2, 70),  // 70 < 75 → low (uses retry threshold)
        sb(3, 60, true),  // 60 < 75 → low (retried)
        sb(4, 88, true),
      ]}
      onBatchRetry={() => {}}
      batchRetrying={false}
    />);
    // avg = (90+70+60+88)/4 = 77
    expect(screen.getByText('77')).toBeInTheDocument();
    expect(screen.getByText(/镜需重生/)).toBeInTheDocument();
    expect(screen.getByText(/已自动重生 2 镜/)).toBeInTheDocument();
  });

  it('fires onBatchRetry with low-score shot numbers when button clicked', () => {
    const onBatchRetry = vi.fn();
    render(<CameoSummary
      storyboards={[sb(1, 50), sb(2, 90), sb(3, 65)]}
      onBatchRetry={onBatchRetry}
      batchRetrying={false}
    />);
    const btn = screen.getByRole('button', { name: /批量重生/ });
    fireEvent.click(btn);
    expect(onBatchRetry).toHaveBeenCalledWith([1, 3]);
  });

  it('shows "all passed" message and no retry button when no low scores', () => {
    render(<CameoSummary
      storyboards={[sb(1, 88), sb(2, 92)]}
      onBatchRetry={() => {}}
      batchRetrying={false}
    />);
    expect(screen.getByText(/所有镜头已达标/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批量重生/ })).toBeNull();
  });

  it('disables button + shows spinning state when batchRetrying', () => {
    render(<CameoSummary
      storyboards={[sb(1, 50)]}
      onBatchRetry={() => {}}
      batchRetrying={true}
    />);
    const btn = screen.getByRole('button', { name: /重生中/ });
    expect(btn).toBeDisabled();
  });
});
