export function SiteFooter() {
  return (
    <footer className="px-[5vw] py-[60px] bg-[#0A0A0A] border-t border-[var(--border)]">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <div className="flex flex-col mb-3">
            <span className="text-[22px] font-bold brand-gradient">青枫漫剧</span>
            <span className="text-xs text-[var(--soft)]">QingFeng Manju</span>
          </div>
          <p className="text-sm text-[var(--soft)]">AI Animation Agent Studio</p>
          <p className="text-sm text-[var(--soft)] mt-1">hello@qfmanju.ai</p>
        </div>
        <div>
          <h4 className="font-semibold mb-3">产品</h4>
          <p className="text-sm text-[var(--soft)] mb-1.5">功能概览</p>
          <p className="text-sm text-[var(--soft)] mb-1.5">价格计划</p>
          <p className="text-sm text-[var(--soft)] mb-1.5">案例库</p>
        </div>
        <div>
          <h4 className="font-semibold mb-3">公司</h4>
          <p className="text-sm text-[var(--soft)] mb-1.5">关于我们</p>
          <p className="text-sm text-[var(--soft)] mb-1.5">加入我们</p>
          <p className="text-sm text-[var(--soft)] mb-1.5">隐私政策</p>
        </div>
        <div>
          <h4 className="font-semibold mb-3">资源</h4>
          <p className="text-sm text-[var(--soft)] mb-1.5">使用文档</p>
          <p className="text-sm text-[var(--soft)] mb-1.5">支持中心</p>
        </div>
      </div>
    </footer>
  );
}
