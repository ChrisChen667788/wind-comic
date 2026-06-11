// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SafeAreaOverlay } from '@/components/ui/safe-area-overlay';

describe('SafeAreaOverlay(v10.6.0)', () => {
  afterEach(cleanup);

  it('渲染三块危险区 + 安全带标签;纯展示(aria-hidden + pointer-events-none)', () => {
    const { container } = render(<SafeAreaOverlay />);
    expect(screen.getByText('顶部 UI 区')).toBeTruthy();
    expect(screen.getByText('互动列')).toBeTruthy();
    expect(screen.getByText(/字幕\/操作区/)).toBeTruthy();
    expect(screen.getByText('安全带')).toBeTruthy();
    const root = container.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.className).toContain('pointer-events-none');
  });
});
