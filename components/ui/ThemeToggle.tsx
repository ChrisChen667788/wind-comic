'use client';

import { useLayoutStore } from '@/stores/layoutStore';
import { useEffect } from 'react';

export default function ThemeToggle() {
  const { darkMode, toggleDarkMode } = useLayoutStore();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <button
      onClick={toggleDarkMode}
      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-label="切换主题"
      title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
    >
      {darkMode ? '🌙' : '☀️'}
    </button>
  );
}
