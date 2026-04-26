'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

interface SidebarProps {
  width: number;
}

export default function Sidebar({ width }: SidebarProps) {
  const [activeTab, setActiveTab] = useState('text');

  const tools = [
    { id: 'text', icon: '📝', label: '文本生成' },
    { id: 'image', icon: '🎨', label: '图片生成' },
    { id: 'video', icon: '🎬', label: '视频生成' },
    { id: 'effect', icon: '✨', label: '特效' },
    { id: 'assets', icon: '📦', label: '资产库' },
  ];

  return (
    <motion.div
      initial={{ x: -width }}
      animate={{ x: 0 }}
      exit={{ x: -width }}
      className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col"
      style={{ width }}
    >
      {/* Tool Tabs */}
      <div className="flex flex-col gap-2 p-4">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTab(tool.id)}
            className={`
              flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
              ${activeTab === tool.id
                ? 'bg-blue-500 text-white'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }
            `}
          >
            <span className="text-2xl">{tool.icon}</span>
            <span className="text-sm font-medium">{tool.label}</span>
          </button>
        ))}
      </div>

      {/* Tool Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <ToolContent activeTab={activeTab} />
      </div>
    </motion.div>
  );
}

function ToolContent({ activeTab }: { activeTab: string }) {
  const contentMap: Record<string, { title: string; description: string }> = {
    text: {
      title: '文本生成',
      description: '使用 AI 生成漫画脚本、对话和故事'
    },
    image: {
      title: '图片生成',
      description: '生成漫画场景、角色和背景图片'
    },
    video: {
      title: '视频生成',
      description: '将漫画场景转换为动态视频'
    },
    effect: {
      title: '特效',
      description: '为漫画添加视觉特效和滤镜'
    },
    assets: {
      title: '资产库',
      description: '管理角色、场景和素材资源'
    }
  };

  const content = contentMap[activeTab];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {content.title}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {content.description}
        </p>
      </div>

      {/* 工具特定内容将在后续添加 */}
      <div className="text-sm text-gray-500 dark:text-gray-500 italic">
        工具内容开发中...
      </div>
    </div>
  );
}
