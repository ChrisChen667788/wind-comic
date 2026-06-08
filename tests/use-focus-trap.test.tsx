import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '@/hooks/use-focus-trap';

function Modal({ onClose }: { onClose?: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button>first</button>
      <button>last</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('打开时焦点移入容器的首个可聚焦元素', () => {
    render(<Modal />);
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('Escape 触发 onClose', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab 在末元素回卷到首元素(焦点陷阱)', () => {
    render(<Modal />);
    screen.getByText('last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('Shift+Tab 在首元素回卷到末元素', () => {
    render(<Modal />);
    screen.getByText('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('last'));
  });

  it('卸载后焦点归还打开前的触发元素', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<Modal />);
    expect(document.activeElement).toBe(screen.getByText('first')); // 焦点已移入
    unmount();
    expect(document.activeElement).toBe(trigger); // 归还
    trigger.remove();
  });
});
