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

// v5.0: 繁体中文 (之前是 zhCN 占位)
const zhTW: Translations = {
  common: {
    create: '建立', save: '儲存', cancel: '取消', delete: '刪除', edit: '編輯',
    share: '分享', download: '下載', loading: '載入中...', error: '錯誤', success: '成功',
  },
  nav: {
    home: '首頁', projects: '我的專案', create: '開始創作', pricing: '定價', profile: '個人資料', settings: '設定',
  },
  create: {
    title: '開始你的創作之旅',
    subtitle: '描述你的故事創意，AI 團隊將為你打造完整的漫劇作品',
    ideaLabel: '故事創意',
    ideaPlaceholder: '例如：一個關於時間旅行者的愛情故事...',
    videoProviderLabel: '影片生成引擎',
    startButton: '開始創作',
  },
  projects: {
    title: '我的專案', subtitle: '管理你所有的 AI 漫劇創作', searchPlaceholder: '搜尋專案標題或描述...',
    filterAll: '全部', filterCompleted: '已完成', filterCreating: '創作中', filterFailed: '失敗', noResults: '沒有找到符合的專案',
  },
};

// v5.0: 日本語 (之前是 zhCN 占位)
const ja: Translations = {
  common: {
    create: '作成', save: '保存', cancel: 'キャンセル', delete: '削除', edit: '編集',
    share: '共有', download: 'ダウンロード', loading: '読み込み中...', error: 'エラー', success: '成功',
  },
  nav: {
    home: 'ホーム', projects: 'マイプロジェクト', create: '作成', pricing: '料金', profile: 'プロフィール', settings: '設定',
  },
  create: {
    title: 'あなたの創作の旅を始めよう',
    subtitle: 'ストーリーのアイデアを入力すると、AIチームが完全なコミックドラマを作成します',
    ideaLabel: 'ストーリーのアイデア',
    ideaPlaceholder: '例：タイムトラベラーのラブストーリー...',
    videoProviderLabel: '動画生成エンジン',
    startButton: '作成開始',
  },
  projects: {
    title: 'マイプロジェクト', subtitle: 'すべてのAIコミックドラマ作品を管理', searchPlaceholder: 'プロジェクトのタイトルや説明を検索...',
    filterAll: 'すべて', filterCompleted: '完了', filterCreating: '作成中', filterFailed: '失敗', noResults: '一致するプロジェクトが見つかりません',
  },
};

const translations: Record<Locale, Translations> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en': en,
  'ja': ja,
};

/** 支持的全部 locale (有序: 简/繁/英/日). */
export const LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'en', 'ja'];

/** 语言切换器显示名 (各用自身语言写). */
export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en': 'English',
  'ja': '日本語',
};

/**
 * 任意语言标签 (浏览器 / Accept-Language) → 我们支持的 Locale.
 * zh-TW / zh-Hant / zh-HK → 繁中; 其余 zh → 简中; en* → en; ja* → ja; 兜底 zh-CN.
 */
export function normalizeLocale(input: string | null | undefined): Locale {
  const s = (input || '').trim().toLowerCase();
  if (!s) return 'zh-CN';
  if (s.startsWith('zh-tw') || s.startsWith('zh-hant') || s.startsWith('zh-hk') || s.startsWith('zh-mo')) return 'zh-TW';
  if (s.startsWith('zh')) return 'zh-CN';
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('en')) return 'en';
  return 'zh-CN';
}

/** 解析 Accept-Language 头, 按 q 权重挑第一个我们支持的语言. */
export function resolveLocaleFromHeader(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return 'zh-CN';
  const parts = acceptLanguage.split(',').map((p) => {
    const [tag, q] = p.trim().split(';q=');
    return { tag: tag.trim(), q: q ? parseFloat(q) : 1 };
  }).sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    const loc = normalizeLocale(tag);
    // normalizeLocale 兜底总返 zh-CN; 只有真匹配上才提前返回
    const s = tag.toLowerCase();
    if (s.startsWith('zh') || s.startsWith('en') || s.startsWith('ja')) return loc;
  }
  return 'zh-CN';
}

/** 深合并: 用 locale 覆盖 zhCN base, 缺的 key 自动回退简中 (未来部分翻译也安全). */
function deepMergeFallback(base: any, over: any): any {
  if (over == null) return base;
  if (typeof base !== 'object' || typeof over !== 'object') return over ?? base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    out[k] = deepMergeFallback(base[k], over[k]);
  }
  return out;
}

export function getTranslations(locale: Locale): Translations {
  const t = translations[locale];
  if (!t) return translations['zh-CN'];
  // 以 zhCN 为底回退, 防某 locale 漏 key 时出现 undefined
  return deepMergeFallback(zhCN, t) as Translations;
}

/** 点路径取翻译 (e.g. t('ja', 'nav.projects')). 缺失回退简中, 再缺回 path. */
export function t(locale: Locale, path: string): string {
  const get = (obj: any) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const v = get(translations[locale]) ?? get(zhCN);
  return typeof v === 'string' ? v : path;
}

export function useTranslations(locale?: Locale) {
  const currentLocale = locale || 'zh-CN';
  return getTranslations(currentLocale);
}
