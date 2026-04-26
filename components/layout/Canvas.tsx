'use client';

import { ReactNode } from 'react';

interface CanvasProps {
  children: ReactNode;
}

export default function Canvas({ children }: CanvasProps) {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-7xl mx-auto">
        {/* Canvas Content */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg min-h-[600px] p-8">
          {children || (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">🎨</div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                开始创作
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                从左侧工具栏选择一个工具开始创作你的漫剧
              </p>
              <div className="flex gap-3">
                <button className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium">
                  新建项目
                </button>
                <button className="px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium">
                  打开项目
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
