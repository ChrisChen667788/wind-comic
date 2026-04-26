'use client';

import { useState } from 'react';

interface Scene {
  id: string;
  thumbnail: string;
  title: string;
  duration?: string;
}

export default function Timeline() {
  const [scenes, setScenes] = useState<Scene[]>([
    { id: '1', thumbnail: '/placeholder.png', title: '场景 1', duration: '3s' },
    { id: '2', thumbnail: '/placeholder.png', title: '场景 2', duration: '5s' },
    { id: '3', thumbnail: '/placeholder.png', title: '场景 3', duration: '4s' },
  ]);

  return (
    <div className="h-32 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 overflow-x-auto">
      <div className="h-full flex items-center gap-2 px-4">
        {/* Add Scene Button */}
        <button className="flex-shrink-0 w-24 h-20 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
          <div className="text-center">
            <div className="text-2xl mb-1">+</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">添加场景</div>
          </div>
        </button>

        {/* Scene Cards */}
        {scenes.map((scene, index) => (
          <div
            key={scene.id}
            className="flex-shrink-0 w-32 h-20 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all group relative"
          >
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-4xl">🎬</span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1 text-center">
              {scene.title}
            </div>
            {scene.duration && (
              <div className="absolute top-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                {scene.duration}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
