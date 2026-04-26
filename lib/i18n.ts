// 国际化 (i18n) 基础设施

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja';

export interface Translations {
  common: {
    create: string;
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    share: string;
    download: string;
    loading: string;
    error: string;
    success: string;
  };
  nav: {
    home: string;
    projects: string;
    create: string;
    pricing: string;
    profile: string;
    settings: string;
  };
  create: {
    title: string;
    subtitle: string;
    ideaLabel: string;
    ideaPlaceholder: string;
    videoProviderLabel: string;
    startButton: string;
  };
  projects: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    filterAll: string;
    filterCompleted: string;
    filterCreating: string;
    filterFailed: string;
    noResults: string;
  };
}

const zhCN: Translations = {
  common: {
    create: '创建',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    share: '分享',
    download: '下载',
    loading: '加载中...',
    error: '错误',
    success: '成功',
  },
  nav: {
    home: '首页',
    projects: '我的项目',
    create: '开始创作',
    pricing: '定价',
    profile: '个人资料',
    settings: '设置',
  },
  create: {
    title: '开始你的创作之旅',
    subtitle: '描述你的故事创意，AI 团队将为你打造完整的漫剧作品',
    ideaLabel: '故事创意',
    ideaPlaceholder: '例如：一个关于时间旅行者的爱情故事...',
    videoProviderLabel: '视频生成引擎',
    startButton: '开始创作',
  },
  projects: {
    title: '我的项目',
    subtitle: '管理你的所有 AI 漫剧创作',
    searchPlaceholder: '搜索项目标题或描述...',
    filterAll: '全部',
    filterCompleted: '已完成',
    filterCreating: '创作中',
    filterFailed: '失败',
    noResults: '没有找到匹配的项目',
  },
};

const en: Translations = {
  common: {
    create: 'Create',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    share: 'Share',
    download: 'Download',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
  },
  nav: {
    home: 'Home',
    projects: 'My Projects',
    create: 'Create',
    pricing: 'Pricing',
    profile: 'Profile',
    settings: 'Settings',
  },
  create: {
    title: 'Start Your Creative Journey',
    subtitle: 'Describe your story idea, and our AI team will create a complete comic drama for you',
    ideaLabel: 'Story Idea',
    ideaPlaceholder: 'e.g., A love story about a time traveler...',
    videoProviderLabel: 'Video Generation Engine',
    startButton: 'Start Creating',
  },
  projects: {
    title: 'My Projects',
    subtitle: 'Manage all your AI comic drama creations',
    searchPlaceholder: 'Search project title or description...',
    filterAll: 'All',
    filterCompleted: 'Completed',
    filterCreating: 'Creating',
    filterFailed: 'Failed',
    noResults: 'No matching projects found',
  },
};

const translations: Record<Locale, Translations> = {
  'zh-CN': zhCN,
  'zh-TW': zhCN, // TODO: Add Traditional Chinese translations
  'en': en,
  'ja': zhCN, // TODO: Add Japanese translations
};

export function getTranslations(locale: Locale): Translations {
  return translations[locale] || translations['zh-CN'];
}

export function useTranslations(locale?: Locale) {
  const currentLocale = locale || 'zh-CN';
  return getTranslations(currentLocale);
}
