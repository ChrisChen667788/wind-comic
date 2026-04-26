import { useState, useEffect } from 'react';

export interface Settings {
  language: string;
  theme: string;
  notifications: {
    email: boolean;
    push: boolean;
    updates: boolean;
  };
  privacy: {
    profilePublic: boolean;
    showActivity: boolean;
  };
}

const DEFAULT_SETTINGS: Settings = {
  language: 'zh-CN',
  theme: 'dark',
  notifications: {
    email: true,
    push: true,
    updates: true,
  },
  privacy: {
    profilePublic: false,
    showActivity: true,
  },
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 从 localStorage 加载设置
    const loadSettings = () => {
      try {
        const stored = localStorage.getItem('app_settings');
        if (stored) {
          setSettings(JSON.parse(stored));
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const updateSettings = (newSettings: Partial<Settings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    try {
      localStorage.setItem('app_settings', JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  return { settings, updateSettings, isLoading };
}
