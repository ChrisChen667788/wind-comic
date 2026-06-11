// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { DemoModeBanner } from '@/components/demo-mode-banner';

const REPORT = {
  readyCount: 2,
  total: 5,
  level: 'script',
  levelLabel: '剧本 / 分镜规划 / 节奏审计全真;画面与视频为示意占位',
  stages: [
    { key: 'script', label: '剧本创作', real: true },
    { key: 'shotVideo', label: '镜头视频', real: false },
  ],
};

describe('DemoModeBanner(v10.5.1 配置进度条)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('部分配置 → 显示进度 N/5 + 分级文案 + 环节真/示意 chips', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => REPORT } as Response);
    render(<DemoModeBanner />);
    await waitFor(() => expect(screen.getByText(/2\/5/)).toBeTruthy());
    expect(screen.getByText(/剧本 \/ 分镜规划 \/ 节奏审计全真/)).toBeTruthy();
    expect(screen.getByText('剧本创作')).toBeTruthy();   // 真 chip
    expect(screen.getByText('镜头视频')).toBeTruthy();   // 示意 chip
  });

  it('全配齐(readyCount=total)→ 整条隐藏', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ ...REPORT, readyCount: 5, total: 5 }),
    } as Response);
    const { container } = render(<DemoModeBanner />);
    await new Promise((r) => setTimeout(r, 40));
    expect(container.textContent).toBe('');
  });

  it('已关闭(localStorage)→ 不渲染且跳过请求', async () => {
    localStorage.setItem('qfmj-demo-banner-dismissed', '1');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => REPORT } as Response);
    const { container } = render(<DemoModeBanner />);
    await new Promise((r) => setTimeout(r, 40));
    expect(container.textContent).toBe('');
    expect(f).not.toHaveBeenCalled();
  });
});
