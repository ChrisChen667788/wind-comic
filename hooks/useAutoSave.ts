'use client';

import { useEffect } from 'react';
import { useProjectStore } from '@/stores/projectStore';

const AUTO_SAVE_INTERVAL = 30000; // 30 秒

export function useAutoSave() {
  const { currentProject, scenes, setLastAutoSave } = useProjectStore();

  useEffect(() => {
    if (!currentProject?.autoSaveEnabled) return;

    const saveProject = async () => {
      try {
        // 这里实现实际的保存逻辑
        // 例如：调用 API 保存到服务器或本地存储
        console.log('自动保存项目...', {
          project: currentProject,
          scenes: scenes
        });

        // 更新最后保存时间
        setLastAutoSave(new Date());
      } catch (error) {
        console.error('自动保存失败:', error);
      }
    };

    // 立即保存一次
    saveProject();

    // 设置定时保存
    const timer = setInterval(saveProject, AUTO_SAVE_INTERVAL);

    return () => clearInterval(timer);
  }, [currentProject, scenes, setLastAutoSave]);
}
