// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { DemoModeBanner } from '@/components/demo-mode-banner';

describe('DemoModeBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the banner when demoMode=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ demoMode: true, engines: [{ kind: 'image', ready: false }, { kind: 'video', ready: false }] }),
    } as Response);
    render(<DemoModeBanner />);
    // i18n 默认 zh-CN → "演示模式";英文环境 → "Demo mode"
    await waitFor(() => expect(screen.getByText(/演示模式|Demo mode/)).toBeTruthy());
  });

  it('renders nothing when demoMode=false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ demoMode: false, engines: [] }) } as Response);
    const { container } = render(<DemoModeBanner />);
    await new Promise((r) => setTimeout(r, 40));
    expect(container.textContent).toBe('');
  });

  it('stays hidden and skips the fetch when previously dismissed', async () => {
    localStorage.setItem('qfmj-demo-banner-dismissed', '1');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ demoMode: true, engines: [] }) } as Response);
    const { container } = render(<DemoModeBanner />);
    await new Promise((r) => setTimeout(r, 40));
    expect(container.textContent).toBe('');
    expect(f).not.toHaveBeenCalled();
  });
});
