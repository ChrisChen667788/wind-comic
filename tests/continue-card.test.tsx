// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const projectsMock = vi.fn();
vi.mock('@/lib/api-client', () => ({ api: { projects: () => projectsMock() } }));

import { ContinueCard } from '@/components/dashboard/continue-card';

describe('ContinueCard(v10.5.4)', () => {
  beforeEach(() => projectsMock.mockReset());
  afterEach(() => cleanup());

  it('有项目 → 渲染标题 + 状态 + 下一步建议', async () => {
    projectsMock.mockResolvedValue([
      { id: 'p1', title: '雨夜信号', status: 'completed', updatedAt: '2026-06-11', covers: [] },
    ]);
    render(<ContinueCard />);
    await waitFor(() => expect(screen.getByText('雨夜信号')).toBeTruthy());
    expect(screen.getByText(/已完成/)).toBeTruthy();
    expect(screen.getByText('看成片 · 跑审计 · 导出')).toBeTruthy(); // CTA label(hint 里也含「导出」,用精确文本)
    expect(screen.getByTestId('continue-card').getAttribute('href')).toBe('/projects/p1');
  });

  it('空项目态不显示(验收条款)', async () => {
    projectsMock.mockResolvedValue([]);
    const { container } = render(<ContinueCard />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });

  it('非法载荷(非数组)→ 不渲染(防御分支)', async () => {
    // 注:拒绝路径由组件 try/catch 静默(代码内已注释);vitest 的 unhandled-rejection
    // 追踪会持有 mock.results 里同一 promise 误报,故这里用「合法但非数组」覆盖防御分支。
    projectsMock.mockResolvedValue({ not: 'array' });
    const { container } = render(<ContinueCard />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });
});
