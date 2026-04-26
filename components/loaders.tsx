// 加载状态组件

export function PageLoader() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 border-4 border-[#E8C547]/30 border-t-rose-500 rounded-full animate-spin mx-auto" />
        <p className="text-gray-400">加载中...</p>
      </div>
    </div>
  );
}

export function ContentLoader() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6 animate-pulse">
          <div className="h-4 bg-white/10 rounded w-3/4 mb-3" />
          <div className="h-4 bg-white/10 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-video bg-white/10" />
      <div className="p-6 space-y-3">
        <div className="h-6 bg-white/10 rounded w-3/4" />
        <div className="h-4 bg-white/10 rounded w-full" />
        <div className="h-4 bg-white/10 rounded w-2/3" />
      </div>
    </div>
  );
}
