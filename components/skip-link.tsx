'use client';

/**
 * v10.3.5 a11y: 跳到主内容 skip link。
 * Chrome 在激活同页 fragment 链接后,焦点常被重置到 <body> 而非目标(即便目标 tabindex=-1)。
 * 真实浏览器里键盘 Enter 会对链接派发 click,故直接在 onClick 里接管:阻止默认跳转 +
 * 显式把焦点/视口移到 #main-content。平时 sr-only,键盘聚焦才显形(全站第一个可聚焦元素)。
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      onClick={(e) => {
        const main = document.getElementById('main-content');
        if (!main) return; // 该页无锚点 → 退回默认行为
        e.preventDefault();
        // preventScroll:避免「聚焦离屏元素触发的自动滚动」与随后的 scrollIntoView 抢焦点
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: 'start' });
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100000] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[var(--primary)] focus:text-black focus:font-semibold focus:shadow-lg"
    >
      跳到主内容
    </a>
  );
}
