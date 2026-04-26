import MainLayout from '@/components/layout/MainLayout';

export default function StudioPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            欢迎来到 AI 漫剧工作室
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            使用左侧工具栏开始创作，右侧面板调整参数
          </p>
        </div>

        {/* 快速开始卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 p-6 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="text-3xl mb-3">📝</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              文本生成
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              使用 AI 生成漫画脚本和对话
            </p>
            <button className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">
              开始创作 →
            </button>
          </div>

          <div className="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/20 dark:to-rose-800/20 p-6 rounded-lg border border-rose-200 dark:border-rose-800">
            <div className="text-3xl mb-3">🎨</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              图片生成
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              生成漫画场景和角色图片
            </p>
            <button className="text-sm text-[#E8C547] dark:text-[#E8C547] font-medium hover:underline">
              开始创作 →
            </button>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 p-6 rounded-lg border border-green-200 dark:border-green-800">
            <div className="text-3xl mb-3">🎬</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              视频生成
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              将场景转换为动态视频
            </p>
            <button className="text-sm text-green-600 dark:text-green-400 font-medium hover:underline">
              开始创作 →
            </button>
          </div>
        </div>

        {/* 最近项目 */}
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            最近项目
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer"
              >
                <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded mb-3 flex items-center justify-center">
                  <span className="text-4xl">🎬</span>
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  项目 {i}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  最后编辑：2 小时前
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
