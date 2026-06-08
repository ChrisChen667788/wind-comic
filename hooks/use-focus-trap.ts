'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * v10.3.5 a11y: 模态焦点管理 hook —— 一处实现,模态复用。
 *   - Escape 关闭:挂在 document(capture)上,不依赖焦点恰好落在模态内
 *   - 焦点陷阱:Tab / Shift+Tab 在容器内循环,不会跑到下方页面
 *   - 打开即把焦点移入容器(首个可聚焦元素,否则容器本身)
 *   - 关闭/卸载时把焦点归还打开前的触发元素
 *
 * 用法:const ref = useFocusTrap<HTMLDivElement>(open, onClose);
 *       <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>…</div>
 *
 * onClose 存进 ref,故即使父级每次传新箭头函数,effect 也只在 active 变化时重挂(焦点不会乱跳)。
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose?: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const prevFocused = document.activeElement as HTMLElement | null;

    // 不用 offsetWidth 判可见(jsdom 全 0、fixed 定位 offsetParent 为 null),改按属性过滤
    const visibleFocusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );

    // 初始焦点移入
    const initial = visibleFocusables()[0];
    (initial ?? node).focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = visibleFocusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // 焦点归还触发器(若它还在文档里)
      if (prevFocused && document.contains(prevFocused)) prevFocused.focus?.();
    };
  }, [active]);

  return ref;
}
