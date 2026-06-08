// 国际化 (i18n) 基础设施

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja';

export interface Translations {
  collab: {
    notifTitle: string; markAllRead: string; justNow: string; mentioned: string; replied: string; notifEmpty: string; loginPrompt: string;
    reply: string; deleted: string; commentPlaceholder: string; commentEmpty: string; send: string; confirmDelete: string;
    demoMode: string; demoEnginesOff: string; demoPlaceholder: string; demoLipsyncReady: string; demoHowToEnable: string; demoImage: string; demoVideo: string;
  };
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
  home: {
    heroTagline1: string;
    heroTagline2: string;
    heroCtaCreate: string;
    heroCtaCases: string;
    featureTitle: string;
    featureSubtitle: string;
    agentsTitle: string;
    agentsSubtitle: string;
    lensCaption: string;
    lensTitle: string;
    lensDesc: string;
    frameTitle: string;
    frameSubtitle: string;
    frameSteps: { title: string; desc: string }[];
    frameCta: string;
    vibeKicker: string;
    vibeTitle: string;
    vibeDesc: string;
    casesTitle: string;
    casesSubtitle: string;
    casesTryNow: string;
    ctaTitle: string;
    ctaDesc: string;
    ctaButton: string;
  };
  pricing: {
    enterWorkbench: string;
    badge: string;
    titleLead: string;
    titleHighlight: string;
    subtitle: string;
    custom: string;
    customNote: string;
    free: string;
    startUsing: string;
    apiAccess: string;
    commercialLicense: string;
    footnote: string;
    faqTitle: string;
    faq: { q: string; a: string }[];
    moreTitle: string;
    moreDesc: string;
    contactSupport: string;
    alertPayment: string;
  };
  help: {
    examples: string;
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    quickGuides: string;
    guides: { title: string; description: string }[];
    faqTitle: string;
    faqs: { q: string; a: string }[];
    moreTitle: string;
    moreDesc: string;
    sendEmail: string;
    liveChat: string;
  };
  examples: {
    title: string;
    subtitle: string;
    ctaTitle: string;
    ctaDesc: string;
    ctaButton: string;
  };
}

const zhCN: Translations = {
  collab: { notifTitle: '通知', markAllRead: '全部标已读', justNow: '刚刚', mentioned: '提到了你', replied: '回复了你', notifEmpty: '暂无通知', loginPrompt: '登录后查看通知', reply: '回复', deleted: '[已删除]', commentPlaceholder: '写评论… @ 提及他人', commentEmpty: '还没有评论,来抢沙发', send: '发送', confirmDelete: '确认删除这条评论?', demoMode: '演示模式', demoEnginesOff: '引擎未配置', demoPlaceholder: '生成将使用占位 / 示意资产', demoLipsyncReady: '口型渲染已零配置可用', demoHowToEnable: '如何启用', demoImage: '图像生成', demoVideo: '视频生成' },
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
  home: {
    heroTagline1: '/ 情绪渲染专家 · 史诗收束',
    heroTagline2: '从静立蓄势，到壮阔全景 — 一支 AI 团队，三段式升格把故事搬上银幕',
    heroCtaCreate: '开始创作 →',
    heroCtaCases: '查看作品',
    featureTitle: '像导演一样掌控节奏',
    featureSubtitle: '脚本、分镜、动画、音效全流程可视化协作。',
    agentsTitle: '一支 AI 动画 Agent 团队',
    agentsSubtitle: '每一个角色都在实时协作。',
    lensCaption: '镜头盒：自定义镜头运动、焦段、视角',
    lensTitle: '镜头语言统一到每一帧',
    lensDesc: '统一风格、色彩与镜头运动规则。',
    frameTitle: '分镜由 AI 快速生成',
    frameSubtitle: '从一句话出发，得到可编辑的多镜头序列。',
    frameSteps: [
      { title: '脚本结构', desc: '智能拆解剧情节奏' },
      { title: '镜头拆解', desc: '自动生成多镜头分镜' },
      { title: '角色设定', desc: '保持角色与风格一致' },
    ],
    frameCta: '生成分镜',
    vibeKicker: '氛围板：实时更新视觉和音效',
    vibeTitle: '氛围与节奏实时预览',
    vibeDesc: '画面、镜头、配乐同时驱动情绪。',
    casesTitle: '案例精选',
    casesSubtitle: '来自青枫漫剧合作伙伴与创作者。',
    casesTryNow: '立即体验',
    ctaTitle: '把故事变成动画',
    ctaDesc: '现在就开始你的第一部 AI 漫剧',
    ctaButton: '进入工作台',
  },
  pricing: {
    enterWorkbench: '进入工作台',
    badge: '定价方案',
    titleLead: '选择适合你的',
    titleHighlight: '创作套餐',
    subtitle: '从免费体验到企业私有化部署，青枫漫剧为每位创作者提供最合适的 AI 漫剧制作方案',
    custom: '定制',
    customNote: '按需报价，联系销售',
    free: '免费',
    startUsing: '开始使用',
    apiAccess: 'API 访问',
    commercialLicense: '商业授权',
    footnote: '所有套餐均包含 7×24 小时 AI 引擎支持 · 付款后立即生效 · 随时可取消',
    faqTitle: '常见问题',
    faq: [
      { q: '免费版有哪些限制？', a: '免费版每月可创建 3 个项目，角色库最多存储 5 个角色，视频导出分辨率为 720p，并包含青枫水印。适合个人体验使用。' },
      { q: '升级后能立即使用新功能吗？', a: '是的，付款成功后系统将立即激活对应套餐的权益，无需等待审核。' },
      { q: '专业版的商业授权包含哪些范围？', a: '专业版商业授权允许将使用青枫漫剧生成的内容用于商业目的，包括广告、品牌宣传、影视发行等，但不包含源模型的二次训练权利。' },
      { q: '企业版与专业版的主要区别是什么？', a: '企业版支持私有化部署，可将整套 AI 系统部署在您的私有服务器上，并提供自定义 AI 智能体开发、SLA 保障和专属客户成功经理服务。' },
      { q: '可以随时取消订阅吗？', a: '可以，您可以随时在账户设置中取消订阅。取消后，当前付费周期结束前仍可正常使用所有功能。' },
    ],
    moreTitle: '还有其他问题？',
    moreDesc: '我们的团队随时为你解答疑问',
    contactSupport: '联系支持团队',
    alertPayment: '支付功能即将上线，敬请期待！',
  },
  help: {
    examples: '示例作品',
    title: '帮助中心',
    subtitle: '找到你需要的答案，快速上手 AI 漫剧创作',
    searchPlaceholder: '搜索帮助文档...',
    quickGuides: '快速指南',
    guides: [
      { title: '快速开始', description: '5分钟学会创作你的第一个 AI 漫剧' },
      { title: '创作指南', description: '掌握 AI 漫剧创作的技巧和最佳实践' },
      { title: '社区教程', description: '来自创作者社区的经验分享' },
    ],
    faqTitle: '常见问题',
    faqs: [
      { q: '如何开始创作我的第一个项目？', a: '点击「开始创作」按钮，输入你的故事创意，选择视频生成引擎，AI 会自动为你生成完整的漫剧作品。' },
      { q: '支持哪些视频生成引擎？', a: '我们支持 Minimax、Vidu 和可灵 AI 等多个视频生成引擎，你可以根据需求选择最适合的引擎。' },
      { q: '生成一个项目需要多长时间？', a: '通常需要 5-15 分钟，具体时间取决于项目复杂度和所选的视频生成引擎。' },
      { q: '可以编辑 AI 生成的内容吗？', a: '是的，你可以编辑剧本、调整角色设计、修改分镜图，完全掌控创作过程。' },
      { q: '生成的作品可以商用吗？', a: '专业版和企业版用户可以将作品用于商业用途。免费版仅供个人学习使用。' },
      { q: '如何导出我的作品？', a: '在项目详情页点击「下载」按钮，可以导出视频、图片和剧本等所有素材。' },
    ],
    moreTitle: '还有其他问题？',
    moreDesc: '我们的支持团队随时为你提供帮助',
    sendEmail: '发送邮件',
    liveChat: '在线客服',
  },
  examples: {
    title: '精选作品',
    subtitle: '探索由 AI 创作的精彩漫剧作品',
    ctaTitle: '准备好创作你的作品了吗？',
    ctaDesc: '加入数千位创作者，开始你的 AI 漫剧创作之旅',
    ctaButton: '立即开始创作',
  },
};

const en: Translations = {
  collab: { notifTitle: 'Notifications', markAllRead: 'Mark all read', justNow: 'just now', mentioned: 'mentioned you', replied: 'replied to you', notifEmpty: 'No notifications', loginPrompt: 'Sign in to see notifications', reply: 'Reply', deleted: '[deleted]', commentPlaceholder: 'Write a comment… @ to mention', commentEmpty: 'No comments yet — be the first', send: 'Send', confirmDelete: 'Delete this comment?', demoMode: 'Demo mode', demoEnginesOff: 'engine(s) not configured', demoPlaceholder: 'generations will use placeholder assets', demoLipsyncReady: 'lip-sync render works out of the box', demoHowToEnable: 'How to enable', demoImage: 'image', demoVideo: 'video' },
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
  home: {
    heroTagline1: '/ Emotion-rendering specialists · Epic finales',
    heroTagline2: 'From a poised stillness to a sweeping panorama — one AI team brings your story to the screen in three escalating beats.',
    heroCtaCreate: 'Start Creating →',
    heroCtaCases: 'View Work',
    featureTitle: 'Direct the pacing like a filmmaker',
    featureSubtitle: 'Visual, collaborative workflow across script, storyboard, animation and sound.',
    agentsTitle: 'An AI animation agent team',
    agentsSubtitle: 'Every role collaborating in real time.',
    lensCaption: 'Lens box: customize camera movement, focal length and angle',
    lensTitle: 'Cinematic language, unified to every frame',
    lensDesc: 'Consistent style, color and camera-movement rules.',
    frameTitle: 'Storyboards generated fast by AI',
    frameSubtitle: 'From a single sentence to an editable multi-shot sequence.',
    frameSteps: [
      { title: 'Script structure', desc: 'Smartly parse story pacing' },
      { title: 'Shot breakdown', desc: 'Auto-generate multi-shot storyboards' },
      { title: 'Character setup', desc: 'Keep characters and style consistent' },
    ],
    frameCta: 'Generate Storyboard',
    vibeKicker: 'Mood board: live visual and audio updates',
    vibeTitle: 'Preview mood and rhythm in real time',
    vibeDesc: 'Visuals, camera and score drive the emotion together.',
    casesTitle: 'Featured Cases',
    casesSubtitle: 'From QingFeng partners and creators.',
    casesTryNow: 'Try Now',
    ctaTitle: 'Turn your story into animation',
    ctaDesc: 'Start your first AI comic drama now',
    ctaButton: 'Enter Workbench',
  },
  pricing: {
    enterWorkbench: 'Enter Workbench',
    badge: 'Pricing',
    titleLead: 'Choose the ',
    titleHighlight: 'plan that fits you',
    subtitle: 'From free trials to enterprise self-hosting, QingFeng offers every creator the right AI comic-production plan.',
    custom: 'Custom',
    customNote: 'Quote on request, contact sales',
    free: 'Free',
    startUsing: 'Get Started',
    apiAccess: 'API access',
    commercialLicense: 'Commercial license',
    footnote: 'All plans include 24/7 AI engine support · effective immediately after payment · cancel anytime',
    faqTitle: 'FAQ',
    faq: [
      { q: 'What are the limits of the Free plan?', a: 'The Free plan allows 3 projects per month, up to 5 characters in the library, 720p video export, and includes a QingFeng watermark. Best for individual trials.' },
      { q: 'Can I use new features right after upgrading?', a: 'Yes. Once payment succeeds, the corresponding plan benefits activate immediately — no review wait.' },
      { q: 'What does the Pro commercial license cover?', a: "The Pro commercial license lets you use content generated with QingFeng for commercial purposes — ads, branding, film distribution and more — but does not include rights to retrain the source models." },
      { q: 'How does Enterprise differ from Pro?', a: 'Enterprise supports self-hosting — deploying the full AI system on your own private servers — plus custom AI-agent development, SLA guarantees, and a dedicated customer success manager.' },
      { q: 'Can I cancel my subscription anytime?', a: 'Yes. You can cancel anytime in account settings. After canceling, you keep full access until the end of the current billing cycle.' },
    ],
    moreTitle: 'Still have questions?',
    moreDesc: 'Our team is always here to help',
    contactSupport: 'Contact Support',
    alertPayment: 'Payments are coming soon — stay tuned!',
  },
  help: {
    examples: 'Examples',
    title: 'Help Center',
    subtitle: 'Find the answers you need and get started with AI comic creation',
    searchPlaceholder: 'Search help docs...',
    quickGuides: 'Quick Guides',
    guides: [
      { title: 'Quick Start', description: 'Create your first AI comic drama in 5 minutes' },
      { title: 'Creation Guide', description: 'Master the techniques and best practices of AI comic creation' },
      { title: 'Community Tutorials', description: 'Tips shared by the creator community' },
    ],
    faqTitle: 'FAQ',
    faqs: [
      { q: 'How do I start my first project?', a: 'Click "Start Creating", enter your story idea, pick a video engine, and the AI generates a complete comic drama for you.' },
      { q: 'Which video engines are supported?', a: 'We support Minimax, Vidu and Kling AI, among others — pick the engine that best fits your needs.' },
      { q: 'How long does it take to generate a project?', a: 'Usually 5–15 minutes, depending on project complexity and the chosen video engine.' },
      { q: 'Can I edit AI-generated content?', a: 'Yes — you can edit the script, adjust character designs and revise the storyboard, staying fully in control.' },
      { q: 'Can I use the work commercially?', a: 'Pro and Enterprise users can use their work commercially. The Free plan is for personal learning only.' },
      { q: 'How do I export my work?', a: 'On the project detail page, click "Download" to export video, images, script and all assets.' },
    ],
    moreTitle: 'Still have questions?',
    moreDesc: 'Our support team is always ready to help',
    sendEmail: 'Send Email',
    liveChat: 'Live Chat',
  },
  examples: {
    title: 'Featured Work',
    subtitle: 'Explore stunning comic dramas created by AI',
    ctaTitle: 'Ready to create your own?',
    ctaDesc: 'Join thousands of creators and start your AI comic journey',
    ctaButton: 'Start Creating Now',
  },
};

// v5.0: 繁体中文 (之前是 zhCN 占位)
const zhTW: Translations = {
  collab: { notifTitle: '通知', markAllRead: '全部標已讀', justNow: '剛剛', mentioned: '提到了你', replied: '回覆了你', notifEmpty: '暫無通知', loginPrompt: '登入後查看通知', reply: '回覆', deleted: '[已刪除]', commentPlaceholder: '寫評論… @ 提及他人', commentEmpty: '還沒有評論,來搶沙發', send: '發送', confirmDelete: '確認刪除這條評論?', demoMode: '示範模式', demoEnginesOff: '引擎未設定', demoPlaceholder: '生成將使用佔位 / 示意素材', demoLipsyncReady: '口型算繪已零設定可用', demoHowToEnable: '如何啟用', demoImage: '圖像生成', demoVideo: '影片生成' },
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
  home: {
    heroTagline1: '/ 情緒渲染專家 · 史詩收束',
    heroTagline2: '從靜立蓄勢，到壯闊全景 — 一支 AI 團隊，三段式升格把故事搬上銀幕',
    heroCtaCreate: '開始創作 →',
    heroCtaCases: '查看作品',
    featureTitle: '像導演一樣掌控節奏',
    featureSubtitle: '腳本、分鏡、動畫、音效全流程可視化協作。',
    agentsTitle: '一支 AI 動畫 Agent 團隊',
    agentsSubtitle: '每一個角色都在即時協作。',
    lensCaption: '鏡頭盒：自訂鏡頭運動、焦段、視角',
    lensTitle: '鏡頭語言統一到每一幀',
    lensDesc: '統一風格、色彩與鏡頭運動規則。',
    frameTitle: '分鏡由 AI 快速生成',
    frameSubtitle: '從一句話出發，得到可編輯的多鏡頭序列。',
    frameSteps: [
      { title: '腳本結構', desc: '智慧拆解劇情節奏' },
      { title: '鏡頭拆解', desc: '自動生成多鏡頭分鏡' },
      { title: '角色設定', desc: '保持角色與風格一致' },
    ],
    frameCta: '生成分鏡',
    vibeKicker: '氛圍板：即時更新視覺和音效',
    vibeTitle: '氛圍與節奏即時預覽',
    vibeDesc: '畫面、鏡頭、配樂同時驅動情緒。',
    casesTitle: '案例精選',
    casesSubtitle: '來自青楓漫劇合作夥伴與創作者。',
    casesTryNow: '立即體驗',
    ctaTitle: '把故事變成動畫',
    ctaDesc: '現在就開始你的第一部 AI 漫劇',
    ctaButton: '進入工作台',
  },
  pricing: {
    enterWorkbench: '進入工作台',
    badge: '定價方案',
    titleLead: '選擇適合你的',
    titleHighlight: '創作套餐',
    subtitle: '從免費體驗到企業私有化部署，青楓漫劇為每位創作者提供最合適的 AI 漫劇製作方案',
    custom: '客製',
    customNote: '依需求報價，聯絡銷售',
    free: '免費',
    startUsing: '開始使用',
    apiAccess: 'API 存取',
    commercialLicense: '商業授權',
    footnote: '所有套餐均包含 7×24 小時 AI 引擎支援 · 付款後立即生效 · 隨時可取消',
    faqTitle: '常見問題',
    faq: [
      { q: '免費版有哪些限制？', a: '免費版每月可建立 3 個專案，角色庫最多儲存 5 個角色，影片匯出解析度為 720p，並包含青楓浮水印。適合個人體驗使用。' },
      { q: '升級後能立即使用新功能嗎？', a: '是的，付款成功後系統將立即啟用對應套餐的權益，無需等待審核。' },
      { q: '專業版的商業授權包含哪些範圍？', a: '專業版商業授權允許將使用青楓漫劇生成的內容用於商業目的，包括廣告、品牌宣傳、影視發行等，但不包含原始模型的二次訓練權利。' },
      { q: '企業版與專業版的主要區別是什麼？', a: '企業版支援私有化部署，可將整套 AI 系統部署在您的私有伺服器上，並提供自訂 AI 智慧體開發、SLA 保障和專屬客戶成功經理服務。' },
      { q: '可以隨時取消訂閱嗎？', a: '可以，您可以隨時在帳戶設定中取消訂閱。取消後，當前付費週期結束前仍可正常使用所有功能。' },
    ],
    moreTitle: '還有其他問題？',
    moreDesc: '我們的團隊隨時為你解答疑問',
    contactSupport: '聯絡支援團隊',
    alertPayment: '付款功能即將上線，敬請期待！',
  },
  help: {
    examples: '範例作品',
    title: '說明中心',
    subtitle: '找到你需要的答案，快速上手 AI 漫劇創作',
    searchPlaceholder: '搜尋說明文件...',
    quickGuides: '快速指南',
    guides: [
      { title: '快速開始', description: '5 分鐘學會創作你的第一個 AI 漫劇' },
      { title: '創作指南', description: '掌握 AI 漫劇創作的技巧和最佳實踐' },
      { title: '社群教學', description: '來自創作者社群的經驗分享' },
    ],
    faqTitle: '常見問題',
    faqs: [
      { q: '如何開始創作我的第一個專案？', a: '點擊「開始創作」按鈕，輸入你的故事創意，選擇影片生成引擎，AI 會自動為你生成完整的漫劇作品。' },
      { q: '支援哪些影片生成引擎？', a: '我們支援 Minimax、Vidu 和可靈 AI 等多個影片生成引擎，你可以依需求選擇最適合的引擎。' },
      { q: '生成一個專案需要多長時間？', a: '通常需要 5-15 分鐘，具體時間取決於專案複雜度和所選的影片生成引擎。' },
      { q: '可以編輯 AI 生成的內容嗎？', a: '是的，你可以編輯腳本、調整角色設計、修改分鏡圖，完全掌控創作過程。' },
      { q: '生成的作品可以商用嗎？', a: '專業版和企業版使用者可以將作品用於商業用途。免費版僅供個人學習使用。' },
      { q: '如何匯出我的作品？', a: '在專案詳情頁點擊「下載」按鈕，可以匯出影片、圖片和腳本等所有素材。' },
    ],
    moreTitle: '還有其他問題？',
    moreDesc: '我們的支援團隊隨時為你提供協助',
    sendEmail: '寄送郵件',
    liveChat: '線上客服',
  },
  examples: {
    title: '精選作品',
    subtitle: '探索由 AI 創作的精彩漫劇作品',
    ctaTitle: '準備好創作你的作品了嗎？',
    ctaDesc: '加入數千位創作者，開始你的 AI 漫劇創作之旅',
    ctaButton: '立即開始創作',
  },
};

// v5.0: 日本語 (之前是 zhCN 占位)
const ja: Translations = {
  collab: { notifTitle: '通知', markAllRead: 'すべて既読', justNow: 'たった今', mentioned: 'メンションされました', replied: '返信されました', notifEmpty: '通知はありません', loginPrompt: 'ログインして通知を表示', reply: '返信', deleted: '[削除済み]', commentPlaceholder: 'コメントを入力… @ でメンション', commentEmpty: 'まだコメントはありません', send: '送信', confirmDelete: 'このコメントを削除しますか?', demoMode: 'デモモード', demoEnginesOff: 'エンジン未設定', demoPlaceholder: '生成にはプレースホルダー素材を使用します', demoLipsyncReady: 'リップシンクはゼロ設定で利用可能', demoHowToEnable: '有効化の方法', demoImage: '画像生成', demoVideo: '動画生成' },
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
  home: {
    heroTagline1: '/ 感情表現のスペシャリスト · 壮大なフィナーレ',
    heroTagline2: '静かな構えから壮大なパノラマへ — 一つのAIチームが、三段階の高まりで物語をスクリーンへ。',
    heroCtaCreate: '作成を始める →',
    heroCtaCases: '作品を見る',
    featureTitle: '映画監督のようにテンポを操る',
    featureSubtitle: '脚本・絵コンテ・アニメ・効果音まで、全工程をビジュアルに共同編集。',
    agentsTitle: 'AIアニメーション・エージェントチーム',
    agentsSubtitle: 'すべての役割がリアルタイムで協働。',
    lensCaption: 'レンズボックス: カメラの動き・焦点距離・アングルをカスタマイズ',
    lensTitle: 'カメラ言語をすべてのフレームに統一',
    lensDesc: 'スタイル・色・カメラワークのルールを統一。',
    frameTitle: '絵コンテをAIが高速生成',
    frameSubtitle: '一文から、編集可能なマルチショットのシーケンスへ。',
    frameSteps: [
      { title: '脚本構成', desc: '物語のテンポをスマートに分解' },
      { title: 'ショット分解', desc: 'マルチショット絵コンテを自動生成' },
      { title: 'キャラクター設定', desc: 'キャラクターとスタイルの一貫性を保持' },
    ],
    frameCta: '絵コンテを生成',
    vibeKicker: 'ムードボード: ビジュアルと音声をリアルタイム更新',
    vibeTitle: 'ムードとリズムをリアルタイムでプレビュー',
    vibeDesc: '映像・カメラ・音楽が一体となって感情を動かす。',
    casesTitle: '注目の事例',
    casesSubtitle: '青楓のパートナーとクリエイターより。',
    casesTryNow: '今すぐ体験',
    ctaTitle: '物語をアニメーションに',
    ctaDesc: '今すぐ最初のAIコミックドラマを始めよう',
    ctaButton: 'ワークベンチへ',
  },
  pricing: {
    enterWorkbench: 'ワークベンチへ',
    badge: '料金プラン',
    titleLead: 'あなたに合った',
    titleHighlight: '制作プランを選ぶ',
    subtitle: '無料トライアルから企業向けセルフホストまで、青楓は各クリエイターに最適なAIコミック制作プランを提供します。',
    custom: 'カスタム',
    customNote: '要見積もり、営業へお問い合わせ',
    free: '無料',
    startUsing: '使ってみる',
    apiAccess: 'API アクセス',
    commercialLicense: '商用ライセンス',
    footnote: '全プランに 24 時間 365 日の AI エンジンサポート付き · 支払い後すぐ有効 · いつでも解約可能',
    faqTitle: 'よくある質問',
    faq: [
      { q: '無料プランの制限は？', a: '無料プランは月に3プロジェクト、キャラクターライブラリは最大5体、動画の書き出しは720p、青楓のウォーターマーク付きです。個人のお試しに最適です。' },
      { q: 'アップグレード後すぐ新機能を使えますか？', a: 'はい。支払いが完了すると、該当プランの特典がすぐに有効になります。審査待ちはありません。' },
      { q: 'プロ版の商用ライセンスの範囲は？', a: 'プロ版の商用ライセンスでは、青楓で生成したコンテンツを広告・ブランディング・映像配信などの商用目的に利用できます。ただし元モデルの再学習権は含まれません。' },
      { q: '企業版とプロ版の主な違いは？', a: '企業版はセルフホストに対応し、AIシステム一式を自社のプライベートサーバーに導入できます。さらにカスタムAIエージェント開発、SLA保証、専任のカスタマーサクセスマネージャーが付きます。' },
      { q: 'いつでも解約できますか？', a: 'はい。アカウント設定からいつでも解約できます。解約後も、現在の請求期間の終了までは全機能を利用できます。' },
    ],
    moreTitle: '他にご質問は？',
    moreDesc: '私たちのチームがいつでもお答えします',
    contactSupport: 'サポートに連絡',
    alertPayment: '決済機能は近日公開予定です。お楽しみに！',
  },
  help: {
    examples: 'サンプル作品',
    title: 'ヘルプセンター',
    subtitle: '必要な答えを見つけて、AIコミック制作をすぐに始めよう',
    searchPlaceholder: 'ヘルプ記事を検索...',
    quickGuides: 'クイックガイド',
    guides: [
      { title: 'クイックスタート', description: '5分で最初のAIコミックドラマを作成' },
      { title: '制作ガイド', description: 'AIコミック制作のコツとベストプラクティスを習得' },
      { title: 'コミュニティチュートリアル', description: 'クリエイターコミュニティからの経験談' },
    ],
    faqTitle: 'よくある質問',
    faqs: [
      { q: '最初のプロジェクトはどう始めますか？', a: '「作成を始める」をクリックし、ストーリーのアイデアを入力、動画エンジンを選ぶと、AIが完全なコミックドラマを自動生成します。' },
      { q: '対応している動画エンジンは？', a: 'Minimax、Vidu、可灵 AI など複数の動画エンジンに対応しています。ニーズに合わせて選べます。' },
      { q: 'プロジェクト生成にかかる時間は？', a: '通常5〜15分です。プロジェクトの複雑さと選んだ動画エンジンによって変わります。' },
      { q: 'AIが生成した内容を編集できますか？', a: 'はい。脚本の編集、キャラクターデザインの調整、絵コンテの修正ができ、制作を完全にコントロールできます。' },
      { q: '生成した作品は商用利用できますか？', a: 'プロ版・企業版のユーザーは商用利用できます。無料版は個人学習用途のみです。' },
      { q: '作品はどう書き出しますか？', a: 'プロジェクト詳細ページの「ダウンロード」をクリックすると、動画・画像・脚本などすべての素材を書き出せます。' },
    ],
    moreTitle: '他にご質問は？',
    moreDesc: 'サポートチームがいつでもお手伝いします',
    sendEmail: 'メールを送る',
    liveChat: 'オンラインサポート',
  },
  examples: {
    title: '注目の作品',
    subtitle: 'AIが創作した素晴らしいコミックドラマを探そう',
    ctaTitle: '自分の作品を作る準備はできましたか？',
    ctaDesc: '数千人のクリエイターに加わり、AIコミック制作の旅を始めよう',
    ctaButton: '今すぐ作成を始める',
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
