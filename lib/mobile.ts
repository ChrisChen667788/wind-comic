// 移动端响应式优化工具

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < breakpoints.md;
}

export function isTablet(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= breakpoints.md && window.innerWidth < breakpoints.lg;
}

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= breakpoints.lg;
}

// 移动端优化的触摸事件处理
export function handleTouchScroll(element: HTMLElement) {
  let startY = 0;

  element.addEventListener('touchstart', (e) => {
    startY = e.touches[0].pageY;
  });

  element.addEventListener('touchmove', (e) => {
    const currentY = e.touches[0].pageY;
    const diff = startY - currentY;

    // 防止过度滚动
    if (element.scrollTop === 0 && diff < 0) {
      e.preventDefault();
    }

    if (element.scrollHeight - element.scrollTop === element.clientHeight && diff > 0) {
      e.preventDefault();
    }
  });
}
