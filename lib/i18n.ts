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
    saveChanges: string;
    saving: string;
    reset: string;
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
  settings: {
    title: string;
    subtitle: string;
    general: string;
    generalDesc: string;
    language: string;
    appearance: string;
    appearanceDesc: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    themeAuto: string;
    notifications: string;
    notificationsDesc: string;
    projectDone: string;
    projectDoneDesc: string;
    performance: string;
    performanceDesc: string;
    videoQuality: string;
    qualityHigh: string;
    qualityMedium: string;
    qualityLow: string;
    privacy: string;
    privacyDesc: string;
    changePassword: string;
    enable2fa: string;
    manageDevices: string;
    billing: string;
    billingDesc: string;
    freePlan: string;
    currentPlan: string;
    freeQuota: string;
    upgradePro: string;
    saved: string;
    savedDesc: string;
    resetDone: string;
  };
  profile: {
    title: string;
    subtitle: string;
    avatar: string;
    uploadAvatar: string;
    basicInfo: string;
    basicInfoDesc: string;
    username: string;
    email: string;
    bio: string;
    bioPlaceholder: string;
    stats: string;
    totalProjects: string;
    inProgress: string;
    totalShots: string;
    saveSuccess: string;
    saveSuccessDesc: string;
    role: string;
    accountPrefs: string;
    visualPref: string;
    collabSpace: string;
  };
  billing: {
    title: string;
    currentTier: string;
    paymentNote: string;
    recommended: string;
    currentBadge: string;
    contactUs: string;
    perMonth: string;
    alreadyThis: string;
    freeNoPurchase: string;
    businessTalk: string;
    upgradeTo: string;
    portalNote: string;
    openPortal: string;
    checkoutFailed: string;
    paymentCanceled: string;
    upgradedPrefix: string;
    upgradedSuffix: string;
  };
  cases: {
    title: string;
    titlePublic: string;
    subtitle: string;
    subtitleReuse: string;
    copyPrompt: string;
    copied: string;
    usePrompt: string;
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
    saveChanges: '保存更改',
    saving: '保存中...',
    reset: '重置',
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
  settings: {
    title: '设置',
    subtitle: '管理你的应用偏好和账户设置',
    general: '通用设置',
    generalDesc: '语言和地区偏好',
    language: '语言',
    appearance: '外观',
    appearanceDesc: '自定义界面主题',
    theme: '主题',
    themeDark: '深色模式',
    themeLight: '浅色模式',
    themeAuto: '跟随系统',
    notifications: '通知',
    notificationsDesc: '管理通知偏好',
    projectDone: '项目完成通知',
    projectDoneDesc: '当项目创作完成时接收通知',
    performance: '性能',
    performanceDesc: '优化应用性能',
    videoQuality: '视频质量',
    qualityHigh: '高质量',
    qualityMedium: '中等质量',
    qualityLow: '低质量（节省流量）',
    privacy: '隐私与安全',
    privacyDesc: '保护你的账户安全',
    changePassword: '修改密码',
    enable2fa: '启用两步验证',
    manageDevices: '管理已登录设备',
    billing: '账单与订阅',
    billingDesc: '管理你的订阅计划',
    freePlan: '免费计划',
    currentPlan: '当前计划',
    freeQuota: '每月 10 个项目额度',
    upgradePro: '升级到专业版',
    saved: '设置已保存',
    savedDesc: '你的偏好设置已更新',
    resetDone: '设置已重置',
  },
  profile: {
    title: '个人资料',
    subtitle: '管理你的个人信息和偏好设置',
    avatar: '头像',
    uploadAvatar: '上传头像',
    basicInfo: '基本信息',
    basicInfoDesc: '更新你的个人资料',
    username: '用户名',
    email: '邮箱',
    bio: '个人简介',
    bioPlaceholder: '介绍一下你自己...',
    stats: '创作统计',
    totalProjects: '总项目数',
    inProgress: '进行中',
    totalShots: '总镜头数',
    saveSuccess: '保存成功',
    saveSuccessDesc: '个人资料已更新',
    role: '角色',
    accountPrefs: '账号与偏好设置',
    visualPref: '视觉偏好',
    collabSpace: '协作空间',
  },
  billing: {
    title: '订阅管理',
    currentTier: '当前档位：',
    paymentNote: '支付走 Stripe Checkout(国际版),取消 / 改卡走 Stripe Customer Portal',
    recommended: '推荐',
    currentBadge: '当前档位',
    contactUs: '联系我们',
    perMonth: '/月',
    alreadyThis: '已是此档位',
    freeNoPurchase: '免费 · 无需购买',
    businessTalk: '商务洽谈',
    upgradeTo: '升级到',
    portalNote: '升级 / 降级 / 取消 / 改支付方式都在 Stripe Customer Portal 完成;自托管需配置 STRIPE_PORTAL_LINK。',
    openPortal: '打开 Stripe Customer Portal',
    checkoutFailed: 'Checkout 失败',
    paymentCanceled: '已取消支付',
    upgradedPrefix: '已升级到',
    upgradedSuffix: '!订阅已激活',
  },
  cases: {
    title: '案例库',
    titlePublic: '案例精选',
    subtitle: '来自青枫漫剧合作伙伴与创作者',
    subtitleReuse: '来自青枫漫剧合作伙伴与创作者 · 点击一键复用创意',
    copyPrompt: '复制提示词',
    copied: '已复制',
    usePrompt: '用这个创作',
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
    saveChanges: 'Save Changes',
    saving: 'Saving...',
    reset: 'Reset',
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
  settings: {
    title: 'Settings',
    subtitle: 'Manage your app preferences and account settings',
    general: 'General',
    generalDesc: 'Language and region preferences',
    language: 'Language',
    appearance: 'Appearance',
    appearanceDesc: 'Customize the interface theme',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeAuto: 'System',
    notifications: 'Notifications',
    notificationsDesc: 'Manage notification preferences',
    projectDone: 'Project completion alerts',
    projectDoneDesc: 'Get notified when a project finishes',
    performance: 'Performance',
    performanceDesc: 'Optimize app performance',
    videoQuality: 'Video Quality',
    qualityHigh: 'High',
    qualityMedium: 'Medium',
    qualityLow: 'Low (save data)',
    privacy: 'Privacy & Security',
    privacyDesc: 'Protect your account',
    changePassword: 'Change Password',
    enable2fa: 'Enable 2FA',
    manageDevices: 'Manage logged-in devices',
    billing: 'Billing & Subscription',
    billingDesc: 'Manage your subscription plan',
    freePlan: 'Free Plan',
    currentPlan: 'Current plan',
    freeQuota: '10 projects per month',
    upgradePro: 'Upgrade to Pro',
    saved: 'Settings saved',
    savedDesc: 'Your preferences have been updated',
    resetDone: 'Settings reset',
  },
  profile: {
    title: 'Profile',
    subtitle: 'Manage your personal info and preferences',
    avatar: 'Avatar',
    uploadAvatar: 'Upload Avatar',
    basicInfo: 'Basic Info',
    basicInfoDesc: 'Update your profile',
    username: 'Username',
    email: 'Email',
    bio: 'Bio',
    bioPlaceholder: 'Tell us about yourself...',
    stats: 'Creation Stats',
    totalProjects: 'Total Projects',
    inProgress: 'In Progress',
    totalShots: 'Total Shots',
    saveSuccess: 'Saved',
    saveSuccessDesc: 'Profile updated',
    role: 'Role',
    accountPrefs: 'Account and preferences',
    visualPref: 'Visual Preferences',
    collabSpace: 'Collaboration Space',
  },
  billing: {
    title: 'Subscription',
    currentTier: 'Current plan: ',
    paymentNote: 'Payments via Stripe Checkout; cancel or change card via the Stripe Customer Portal',
    recommended: 'Recommended',
    currentBadge: 'Current',
    contactUs: 'Contact Us',
    perMonth: '/mo',
    alreadyThis: 'Current plan',
    freeNoPurchase: 'Free · no purchase',
    businessTalk: 'Contact Sales',
    upgradeTo: 'Upgrade to',
    portalNote: 'Upgrade, downgrade, cancel, or change payment in the Stripe Customer Portal; self-hosting requires STRIPE_PORTAL_LINK.',
    openPortal: 'Open Stripe Customer Portal',
    checkoutFailed: 'Checkout failed',
    paymentCanceled: 'Payment canceled',
    upgradedPrefix: 'Upgraded to',
    upgradedSuffix: '! Subscription active',
  },
  cases: {
    title: 'Showcase',
    titlePublic: 'Featured Cases',
    subtitle: 'From QingFeng partners and creators',
    subtitleReuse: 'From QingFeng partners and creators · click to reuse the idea',
    copyPrompt: 'Copy Prompt',
    copied: 'Copied',
    usePrompt: 'Use This',
  },
};

// v5.0: 繁体中文 (之前是 zhCN 占位)
const zhTW: Translations = {
  common: {
    create: '建立', save: '儲存', cancel: '取消', delete: '刪除', edit: '編輯',
    share: '分享', download: '下載', loading: '載入中...', error: '錯誤', success: '成功',
    viewAll: '查看全部', backHome: '返回首頁',
    saveChanges: '儲存變更', saving: '儲存中...', reset: '重置',
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
  settings: {
    title: '設定',
    subtitle: '管理你的應用偏好與帳戶設定',
    general: '通用設定',
    generalDesc: '語言與地區偏好',
    language: '語言',
    appearance: '外觀',
    appearanceDesc: '自訂介面主題',
    theme: '主題',
    themeDark: '深色模式',
    themeLight: '淺色模式',
    themeAuto: '跟隨系統',
    notifications: '通知',
    notificationsDesc: '管理通知偏好',
    projectDone: '專案完成通知',
    projectDoneDesc: '當專案創作完成時接收通知',
    performance: '效能',
    performanceDesc: '最佳化應用效能',
    videoQuality: '影片品質',
    qualityHigh: '高品質',
    qualityMedium: '中等品質',
    qualityLow: '低品質（節省流量）',
    privacy: '隱私與安全',
    privacyDesc: '保護你的帳戶安全',
    changePassword: '修改密碼',
    enable2fa: '啟用兩步驟驗證',
    manageDevices: '管理已登入裝置',
    billing: '帳單與訂閱',
    billingDesc: '管理你的訂閱方案',
    freePlan: '免費方案',
    currentPlan: '目前方案',
    freeQuota: '每月 10 個專案額度',
    upgradePro: '升級到專業版',
    saved: '設定已儲存',
    savedDesc: '你的偏好設定已更新',
    resetDone: '設定已重置',
  },
  profile: {
    title: '個人資料',
    subtitle: '管理你的個人資訊與偏好設定',
    avatar: '頭像',
    uploadAvatar: '上傳頭像',
    basicInfo: '基本資訊',
    basicInfoDesc: '更新你的個人資料',
    username: '使用者名稱',
    email: '電子郵件',
    bio: '個人簡介',
    bioPlaceholder: '介紹一下你自己...',
    stats: '創作統計',
    totalProjects: '專案總數',
    inProgress: '進行中',
    totalShots: '鏡頭總數',
    saveSuccess: '儲存成功',
    saveSuccessDesc: '個人資料已更新',
    role: '角色',
    accountPrefs: '帳號與偏好設定',
    visualPref: '視覺偏好',
    collabSpace: '協作空間',
  },
  billing: {
    title: '訂閱管理',
    currentTier: '目前方案：',
    paymentNote: '付款走 Stripe Checkout(國際版),取消 / 改卡走 Stripe Customer Portal',
    recommended: '推薦',
    currentBadge: '目前方案',
    contactUs: '聯絡我們',
    perMonth: '/月',
    alreadyThis: '已是此方案',
    freeNoPurchase: '免費 · 無需購買',
    businessTalk: '商務洽談',
    upgradeTo: '升級到',
    portalNote: '升級 / 降級 / 取消 / 改付款方式都在 Stripe Customer Portal 完成;自架需設定 STRIPE_PORTAL_LINK。',
    openPortal: '開啟 Stripe Customer Portal',
    checkoutFailed: 'Checkout 失敗',
    paymentCanceled: '已取消付款',
    upgradedPrefix: '已升級到',
    upgradedSuffix: '!訂閱已啟用',
  },
  cases: {
    title: '案例庫',
    titlePublic: '案例精選',
    subtitle: '來自青楓漫劇合作夥伴與創作者',
    subtitleReuse: '來自青楓漫劇合作夥伴與創作者 · 點擊一鍵複用創意',
    copyPrompt: '複製提示詞',
    copied: '已複製',
    usePrompt: '用這個創作',
  },
};

// v5.0: 日本語 (之前是 zhCN 占位)
const ja: Translations = {
  common: {
    create: '作成', save: '保存', cancel: 'キャンセル', delete: '削除', edit: '編集',
    share: '共有', download: 'ダウンロード', loading: '読み込み中...', error: 'エラー', success: '成功',
    viewAll: 'すべて見る', backHome: 'ホームに戻る',
    saveChanges: '変更を保存', saving: '保存中...', reset: 'リセット',
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
  settings: {
    title: '設定',
    subtitle: 'アプリの設定とアカウント設定を管理',
    general: '一般設定',
    generalDesc: '言語と地域の設定',
    language: '言語',
    appearance: '外観',
    appearanceDesc: 'インターフェースのテーマをカスタマイズ',
    theme: 'テーマ',
    themeDark: 'ダークモード',
    themeLight: 'ライトモード',
    themeAuto: 'システムに従う',
    notifications: '通知',
    notificationsDesc: '通知設定を管理',
    projectDone: 'プロジェクト完了通知',
    projectDoneDesc: 'プロジェクトの作成が完了したら通知を受け取る',
    performance: 'パフォーマンス',
    performanceDesc: 'アプリのパフォーマンスを最適化',
    videoQuality: '動画品質',
    qualityHigh: '高品質',
    qualityMedium: '中品質',
    qualityLow: '低品質（データ節約）',
    privacy: 'プライバシーとセキュリティ',
    privacyDesc: 'アカウントを保護',
    changePassword: 'パスワード変更',
    enable2fa: '二段階認証を有効化',
    manageDevices: 'ログイン中のデバイスを管理',
    billing: '請求と購読',
    billingDesc: '購読プランを管理',
    freePlan: '無料プラン',
    currentPlan: '現在のプラン',
    freeQuota: '月10プロジェクトまで',
    upgradePro: 'プロ版にアップグレード',
    saved: '設定を保存しました',
    savedDesc: '設定が更新されました',
    resetDone: '設定をリセットしました',
  },
  profile: {
    title: 'プロフィール',
    subtitle: '個人情報と設定を管理',
    avatar: 'アバター',
    uploadAvatar: 'アバターをアップロード',
    basicInfo: '基本情報',
    basicInfoDesc: 'プロフィールを更新',
    username: 'ユーザー名',
    email: 'メール',
    bio: '自己紹介',
    bioPlaceholder: '自己紹介を入力...',
    stats: '創作統計',
    totalProjects: 'プロジェクト総数',
    inProgress: '進行中',
    totalShots: 'ショット総数',
    saveSuccess: '保存しました',
    saveSuccessDesc: 'プロフィールを更新しました',
    role: '役割',
    accountPrefs: 'アカウントと設定',
    visualPref: 'ビジュアル設定',
    collabSpace: 'コラボレーション空間',
  },
  billing: {
    title: '購読管理',
    currentTier: '現在のプラン：',
    paymentNote: '支払いは Stripe Checkout 経由、解約 / カード変更は Stripe Customer Portal で',
    recommended: 'おすすめ',
    currentBadge: '現在',
    contactUs: 'お問い合わせ',
    perMonth: '/月',
    alreadyThis: '現在のプラン',
    freeNoPurchase: '無料 · 購入不要',
    businessTalk: '商談',
    upgradeTo: 'アップグレード:',
    portalNote: 'アップグレード / ダウングレード / 解約 / 支払い方法の変更は Stripe Customer Portal で。セルフホスト時は STRIPE_PORTAL_LINK の設定が必要です。',
    openPortal: 'Stripe Customer Portal を開く',
    checkoutFailed: 'Checkout 失敗',
    paymentCanceled: '支払いをキャンセルしました',
    upgradedPrefix: 'アップグレード:',
    upgradedSuffix: '! 購読が有効になりました',
  },
  cases: {
    title: '事例ライブラリ',
    titlePublic: '注目の事例',
    subtitle: '青楓のパートナーとクリエイターより',
    subtitleReuse: '青楓のパートナーとクリエイターより · クリックでアイデアを再利用',
    copyPrompt: 'プロンプトをコピー',
    copied: 'コピー済み',
    usePrompt: 'これで作成',
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
