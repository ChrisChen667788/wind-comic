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
    viewAll: string;
    backHome: string;
  };
  brand: {
    studio: string;
  };
  nav: {
    home: string;
    projects: string;
    create: string;
    pricing: string;
    profile: string;
    settings: string;
    polish: string;
    workbench: string;
    cases: string;
    userCenter: string;
    newProject: string;
  };
  create: {
    badge: string;
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
    createNew: string;
    shotsUnit: string;
  };
  dashboard: {
    systemOnline: string;
    title: string;
    subtitle: string;
    quickStartTitle: string;
    quickStartSubtitle: string;
    statProjects: string;
    statProjectsSub: string;
    statGenerations: string;
    statGenerationsSub: string;
    statCases: string;
    statCasesSub: string;
    recentCreations: string;
    noRecords: string;
    startFirst: string;
    systemStatus: string;
    recentActivity: string;
    statusCompleted: string;
    statusCreating: string;
    statusDraft: string;
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
    viewAll: '查看全部',
    backHome: '返回首页',
  },
  brand: {
    studio: 'AI 漫剧工作室',
  },
  nav: {
    home: '首页',
    projects: '我的项目',
    create: '开始创作',
    pricing: '定价',
    profile: '个人资料',
    settings: '设置',
    polish: '剧本润色',
    workbench: '工作台',
    cases: '作品案例',
    userCenter: '用户中心',
    newProject: '新建项目',
  },
  create: {
    badge: 'AI 创作工作台',
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
    createNew: '创建新项目',
    shotsUnit: '个镜头',
  },
  dashboard: {
    systemOnline: '系统在线',
    title: '创作总览',
    subtitle: 'AI 多智能体协作引擎，从创意到成片的一站式漫剧生产线',
    quickStartTitle: '开始创作',
    quickStartSubtitle: '输入创意，AI 七人团队自动接力创作',
    statProjects: '我的项目',
    statProjectsSub: '创作中的漫剧项目',
    statGenerations: '生成次数',
    statGenerationsSub: '累计 AI 生成调用',
    statCases: '案例库',
    statCasesSub: '可参考的模版案例',
    recentCreations: '最近创作',
    noRecords: '还没有创作记录',
    startFirst: '开始第一次创作 →',
    systemStatus: '系统状态',
    recentActivity: '最近动态',
    statusCompleted: '已完成',
    statusCreating: '创作中',
    statusDraft: '草稿',
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
    viewAll: 'View all',
    backHome: 'Back to Home',
  },
  brand: {
    studio: 'AI Comic Studio',
  },
  nav: {
    home: 'Home',
    projects: 'My Projects',
    create: 'Create',
    pricing: 'Pricing',
    profile: 'Profile',
    settings: 'Settings',
    polish: 'Script Polish',
    workbench: 'Workbench',
    cases: 'Showcase',
    userCenter: 'Dashboard',
    newProject: 'New Project',
  },
  create: {
    badge: 'AI Creation Studio',
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
    createNew: 'Create New Project',
    shotsUnit: 'shots',
  },
  dashboard: {
    systemOnline: 'System Online',
    title: 'Creation Overview',
    subtitle: 'Multi-agent AI engine — an end-to-end comic production line from idea to finished film',
    quickStartTitle: 'Start Creating',
    quickStartSubtitle: 'Enter an idea and a 7-agent AI team creates it for you',
    statProjects: 'My Projects',
    statProjectsSub: 'Comic projects in progress',
    statGenerations: 'Generations',
    statGenerationsSub: 'Total AI generation calls',
    statCases: 'Showcase',
    statCasesSub: 'Reference template cases',
    recentCreations: 'Recent Creations',
    noRecords: 'No creations yet',
    startFirst: 'Start your first creation →',
    systemStatus: 'System Status',
    recentActivity: 'Recent Activity',
    statusCompleted: 'Completed',
    statusCreating: 'Creating',
    statusDraft: 'Draft',
  },
};

// v5.0: 繁体中文 (之前是 zhCN 占位)
const zhTW: Translations = {
  common: {
    create: '建立', save: '儲存', cancel: '取消', delete: '刪除', edit: '編輯',
    share: '分享', download: '下載', loading: '載入中...', error: '錯誤', success: '成功',
    viewAll: '查看全部', backHome: '返回首頁',
  },
  brand: {
    studio: 'AI 漫劇工作室',
  },
  nav: {
    home: '首頁', projects: '我的專案', create: '開始創作', pricing: '定價', profile: '個人資料', settings: '設定',
    polish: '劇本潤色', workbench: '工作台', cases: '作品案例', userCenter: '使用者中心', newProject: '新增專案',
  },
  create: {
    badge: 'AI 創作工作台',
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
    createNew: '建立新專案', shotsUnit: '個鏡頭',
  },
  dashboard: {
    systemOnline: '系統在線',
    title: '創作總覽',
    subtitle: 'AI 多智能體協作引擎，從創意到成片的一站式漫劇生產線',
    quickStartTitle: '開始創作',
    quickStartSubtitle: '輸入創意，AI 七人團隊自動接力創作',
    statProjects: '我的專案',
    statProjectsSub: '創作中的漫劇專案',
    statGenerations: '生成次數',
    statGenerationsSub: '累計 AI 生成呼叫',
    statCases: '案例庫',
    statCasesSub: '可參考的範本案例',
    recentCreations: '最近創作',
    noRecords: '還沒有創作記錄',
    startFirst: '開始第一次創作 →',
    systemStatus: '系統狀態',
    recentActivity: '最近動態',
    statusCompleted: '已完成',
    statusCreating: '創作中',
    statusDraft: '草稿',
  },
};

// v5.0: 日本語 (之前是 zhCN 占位)
const ja: Translations = {
  common: {
    create: '作成', save: '保存', cancel: 'キャンセル', delete: '削除', edit: '編集',
    share: '共有', download: 'ダウンロード', loading: '読み込み中...', error: 'エラー', success: '成功',
    viewAll: 'すべて見る', backHome: 'ホームに戻る',
  },
  brand: {
    studio: 'AI コミックスタジオ',
  },
  nav: {
    home: 'ホーム', projects: 'マイプロジェクト', create: '作成', pricing: '料金', profile: 'プロフィール', settings: '設定',
    polish: '脚本推敲', workbench: 'ワークベンチ', cases: '作品事例', userCenter: 'マイページ', newProject: '新規プロジェクト',
  },
  create: {
    badge: 'AI 創作スタジオ',
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
    createNew: '新しいプロジェクトを作成', shotsUnit: 'ショット',
  },
  dashboard: {
    systemOnline: 'システム稼働中',
    title: '創作概要',
    subtitle: 'AIマルチエージェント協調エンジン — アイデアから完成作品までのワンストップ制作ライン',
    quickStartTitle: '作成を始める',
    quickStartSubtitle: 'アイデアを入力すると、7人のAIチームが自動で創作します',
    statProjects: 'マイプロジェクト',
    statProjectsSub: '制作中のコミックプロジェクト',
    statGenerations: '生成回数',
    statGenerationsSub: 'AI生成呼び出しの累計',
    statCases: '事例ライブラリ',
    statCasesSub: '参考になるテンプレート事例',
    recentCreations: '最近の創作',
    noRecords: 'まだ創作記録がありません',
    startFirst: '最初の創作を始める →',
    systemStatus: 'システム状態',
    recentActivity: '最近の動き',
    statusCompleted: '完了',
    statusCreating: '作成中',
    statusDraft: '下書き',
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
