'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';

interface ParameterPanelProps {
  width: number;
}

export default function ParameterPanel({ width }: ParameterPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('japanese');
  const [width_val, setWidthVal] = useState(1024);
  const [height_val, setHeightVal] = useState(1024);

  return (
    <motion.div
      initial={{ x: width }}
      animate={{ x: 0 }}
      exit={{ x: width }}
      className="bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto"
      style={{ width }}
    >
      <div className="p-6 space-y-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          生成参数
        </h2>

        {/* 提示词输入 */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            提示词
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={4}
            placeholder="描述你想要创作的内容..."
          />
        </div>

        {/* 风格选择 */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            风格
          </label>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="japanese">日式漫画</option>
            <option value="american">美式漫画</option>
            <option value="chinese">国漫</option>
            <option value="webtoon">韩漫</option>
          </select>
        </div>

        {/* 尺寸设置 */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            尺寸
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={width_val}
              onChange={(e) => setWidthVal(Number(e.target.value))}
              placeholder="宽度"
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="number"
              value={height_val}
              onChange={(e) => setHeightVal(Number(e.target.value))}
              placeholder="高度"
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* 高级设置 */}
        <details className="border border-gray-300 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
          <summary className="cursor-pointer font-medium text-gray-900 dark:text-white">
            高级设置
          </summary>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                质量
              </label>
              <select className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                <option>草稿</option>
                <option>标准</option>
                <option>高质量</option>
              </select>
            </div>
          </div>
        </details>

        {/* 生成按钮 */}
        <button className="w-full bg-blue-500 text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition-colors shadow-lg hover:shadow-xl">
          生成
        </button>
      </div>
    </motion.div>
  );
}
