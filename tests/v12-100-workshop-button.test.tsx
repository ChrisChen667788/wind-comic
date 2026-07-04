/**
 * v12.100 — 导演台「广告包装车间」按钮:有成片才显示。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DirectorConsole } from '@/components/director-console';

const baseAssets = [
  { type: 'plan', updatedAt: '2026-07-04', stale: false },
  { type: 'script', updatedAt: '2026-07-04', stale: false },
];

describe('v12.100 · 广告包装车间按钮', () => {
  it('有 final_video + projectId → 按钮渲染', () => {
    render(<DirectorConsole assets={[...baseAssets, { type: 'final_video', updatedAt: '2026-07-04', stale: false }] as any} projectId="p1" />);
    expect(screen.getByText(/广告包装车间/)).toBeTruthy();
  });

  it('无成片 → 不渲染按钮', () => {
    render(<DirectorConsole assets={baseAssets as any} projectId="p1" />);
    expect(screen.queryByText(/广告包装车间/)).toBeNull();
  });
});
