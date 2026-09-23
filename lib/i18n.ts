// 国际化 (i18n) 基础设施

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'ru'; // v12.186:ko/ru 就位(文案先以 en 兜底渐进补)

export interface Translations {
  collab: {
    notifTitle: string; markAllRead: string; justNow: string; mentioned: string; replied: string; notifEmpty: string; loginPrompt: string;
    reply: string; deleted: string; commentPlaceholder: string; commentEmpty: string; send: string; confirmDelete: string;
    demoMode: string; demoEnginesOff: string; demoPlaceholder: string; demoLipsyncReady: string; demoHowToEnable: string; demoImage: string; demoVideo: string;
    readinessTitle: string; readinessReal: string; readinessSim: string;
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
    heroEngines: string;
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

  visionAudit: {
    verdictExcellent: string;
    verdictGood: string;
    verdictNeedsWork: string;
    verdictPoor: string;
    noDataMessage: string;
    panelTitle: string;
    avgScore: string;
    shotUnit: string;
    passLabel: string;
    warnLabel: string;
    failLabel: string;
    weakestShotsTitle: string;
    rebirthPlanPrefix: string;
    rebirthPlanSuffix: string;
    reshootButton: string;
    dimScene: string;
    dimAction: string;
    dimMood: string;
    dimComposition: string;
  };
  usagePage: {
    eyebrow: string;
    headline: string;
    budgetLabel: string;
    budgetPlaceholder: string;
    nearDays: string;
    daySuffix: string;
    daysCostSuffix: string;
    refreshTitle: string;
    loading: string;
    loadFailed: string;
    activeAlertsBanner: string;
    goBilling: string;
    statusOk: string;
    statusWarn: string;
    statusOver: string;
    statusNone: string;
    alertExhausted: string;
    alertSaturated: string;
    alertRateLimited: string;
    alertAuthFailed: string;
    alertModelUnavailable: string;
    thisMonthBudget: string;
    quotaTitle: string;
    quotaUnlimited: string;
    quotaExceeded: string;
    quotaNearLimit: string;
    quotaOfCeiling: string;
    projectedEndPrefix: string;
    noCapSuffix: string;
    statGenerations: string;
    statEngines: string;
    engineCostPrefix: string;
    engineNoData: string;
    dailyTrendTitle: string;
    dailyNoData: string;
    countSuffix: string;
  };
  healthPage: {
    title: string;
    subtitle: string;
    refreshBtn: string;
    loadFailed: string;
    kindLlm: string;
    kindTts: string;
    kindVideo: string;
    kindImage: string;
    kindGateway: string;
    overallHealthy: string;
    overallWarning: string;
    overallCritical: string;
    balanceUsed: string;
    balanceAbundant: string;
    balanceRemaining: string;
    balanceLimit: string;
    radarTitle: string;
    radarDesc: string;
    scanBtn: string;
    upgradeBtn: string;
    statusUpgradable: string;
    statusUpToDate: string;
    statusFamilyN: string;
    statusSourceUnavail: string;
    overridesTitle: string;
    rollbackBtn: string;
    rollbackDefault: string;
    checkedAt: string;
    cachedNote: string;
    footer: string;
    scanFailed: string;
    upgradeFailed: string;
    upgradeFailedLogin: string;
    upgradeNone: string;
    upgradedSummary: string;
    upgradeSkippedNote: string;
    upgradeSomeSkipped: string;
    rolledBack: string;
  };
  seriesDetail: {
    statusDraft: string;
    statusActive: string;
    statusCompleted: string;
    statusFailed: string;
    backLink: string;
    pageTitle: string;
    statTotal: string;
    statCompleted: string;
    statGenerating: string;
    statFailed: string;
    statPending: string;
    batchGenerateBtn: string;
    batchGeneratePendingHint: string;
    regenerateAll: string;
    seasonAssetsTitle: string;
    seasonCoverAlt: string;
    genCoverBtn: string;
    regenCoverBtn: string;
    exportSeasonBtn: string;
    reexportSeasonBtn: string;
    exportFirstEpisodeHint: string;
    watchSeasonVideo: string;
    seasonVideoDesc: string;
    seasonFixBusyLabel: string;
    seasonFixLabel: string;
    seasonFixProgressMsg: string;
    seasonFixDoneMsg: string;
    resumeStuckBtn: string;
    loading: string;
    noEpisodes: string;
    episodeLabel: string;
    healthCheckAllGreen: string;
    shotsDowngradedLabel: string;
    openEpisodeLink: string;
    loadFailStatus: string;
    loadFailNetwork: string;
    requestFailed: string;
    exportingSeasonMsg: string;
    exportCanceledMsg: string;
    exportFailedStatus: string;
    exportDoneMsg: string;
    coverGeneratingMsg: string;
    coverFailedStatus: string;
    coverDoneMsg: string;
    resumeCheckedMsg: string;
    resumeFailedMsg: string;
    resumeFailStatus: string;
    batchQueuedMsg: string;
    batchStartedMsg: string;
    noPendingEpisodes: string;
    healthGateIssuePrefix: string;
    healthGateEpisodeDetail: string;
    healthGateConfirmHint: string;
    dramaPackageBtn: string;
    dramaPackageFetching: string;
    dramaPackageTitle: string;
    dramaPackageDownload: string;
    dramaPackageCoverAlt: string;
    dramaPackageLangEpisodes: string;
    dramaPackageTotalMin: string;
    dramaPackageEpFree: string;
    dramaPackageEpCoins: string;
    dramaPackageGuideTitle: string;
    dramaPackageErrPrefix: string;
    dramaPackageNetworkErr: string;
    dramaPackageViewVideo: string;
    dramaPackageAiDeclaration: string;
    dramaPackageAiRequiredHint: string;
  };
  providerHealth: Record<string, string>;
}

const zhCN: Translations = {
  collab: { notifTitle: '通知', markAllRead: '全部标已读', justNow: '刚刚', mentioned: '提到了你', replied: '回复了你', notifEmpty: '暂无通知', loginPrompt: '登录后查看通知', reply: '回复', deleted: '[已删除]', commentPlaceholder: '写评论… @ 提及他人', commentEmpty: '还没有评论,来抢沙发', send: '发送', confirmDelete: '确认删除这条评论?', demoMode: '演示模式', demoEnginesOff: '引擎未配置', demoPlaceholder: '生成将使用占位 / 示意资产', demoLipsyncReady: '口型渲染已零配置可用', demoHowToEnable: '如何启用', demoImage: '图像生成', demoVideo: '视频生成', readinessTitle: '引擎配置', readinessReal: '真', readinessSim: '示意' },
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
    heroTagline1: '/ AI 短剧制作台 · 不止生成',
    heroTagline2: '节奏审计 · 质量门禁 · 角色锁脸一致性 · AAF/EDL 进剪辑线 · 团队协作 — 把「能出片」变成「能交付」',
    heroEngines: '生成层 · 接入当下最强引擎(BYO Key)',
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
    alertPayment: '支付尚未接入，当前为免费 / 自托管版本。',
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
      { q: '生成的作品可以商用吗？', a: '生成素材的版权归属各底层生成引擎(Kling / MiniMax 等),是否可商用取决于各引擎的服务条款,请自行核对。青枫仅提供多智能体编排与后期编辑工具,不对生成素材的商用权利作担保。' },
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

    visionAudit: {
      verdictExcellent: "优秀",
      verdictGood: "良好",
      verdictNeedsWork: "待优化",
      verdictPoor: "需重做",
      noDataMessage: "还没有成片质检数据。生成成片后即可对每镜画面做「是否对得上剧本」的 AI 评分。",
      panelTitle: "成片质检 · 画面 vs 剧本",
      avgScore: "平均分",
      shotUnit: "镜",
      passLabel: "通过",
      warnLabel: "偏差",
      failLabel: "跑题",
      weakestShotsTitle: "最需关注 (优先重生):",
      rebirthPlanPrefix: "重生计划 · ",
      rebirthPlanSuffix: " 个弱镜建议重拍",
      reshootButton: "一键去工坊重拍",
      dimScene: "场景",
      dimAction: "动作",
      dimMood: "情绪",
      dimComposition: "构图",
    },
    usagePage: {
      eyebrow: "用量与成本",
      headline: "成本可观测",
      budgetLabel: "月预算 ¥",
      budgetPlaceholder: "不限",
      nearDays: "近",
      daySuffix: "天",
      daysCostSuffix: "天花费",
      refreshTitle: "刷新",
      loading: "加载中…",
      loadFailed: "加载失败",
      activeAlertsBanner: "活跃配额告警 · 近 1 小时",
      goBilling: "去计费",
      statusOk: "预算健康",
      statusWarn: "接近上限",
      statusOver: "已超预算",
      statusNone: "未设上限",
      alertExhausted: "额度耗尽",
      alertSaturated: "上游饱和",
      alertRateLimited: "限流",
      alertAuthFailed: "鉴权失败",
      alertModelUnavailable: "模型不可用",
      thisMonthBudget: "本月预算",
      quotaTitle: "本月配额",
      quotaUnlimited: "无上限",
      quotaExceeded: "已超档上限,请充值或改用经济引擎",
      quotaNearLimit: "接近档上限",
      quotaOfCeiling: "档上限",
      projectedEndPrefix: "预计月末",
      noCapSuffix: " · 未设上限",
      statGenerations: "生成次数",
      statEngines: "引擎数",
      engineCostPrefix: "引擎花费 · 近",
      engineNoData: "该窗口暂无成本记录。",
      dailyTrendTitle: "每日成本趋势",
      dailyNoData: "暂无每日数据。",
      countSuffix: "次",
    },
    healthPage: {
      title: "API 健康",
      subtitle: "各模型 / 网关实时状态 · 一眼看谁欠费或掉线",
      refreshBtn: "重新探测",
      loadFailed: "探测失败",
      kindLlm: "大模型",
      kindTts: "语音",
      kindVideo: "视频",
      kindImage: "图像",
      kindGateway: "网关",
      overallHealthy: "全部正常",
      overallWarning: "有警告",
      overallCritical: "有故障 / 欠费",
      balanceUsed: "已用",
      balanceAbundant: "额度充裕(充值制)",
      balanceRemaining: "剩余",
      balanceLimit: "上限",
      radarTitle: "模型雷达",
      radarDesc: "扫描各 API 支持的最新模型 · 同家族才升级 · LLM 先 1-token 实测 · 留回滚 · 免重启生效",
      scanBtn: "扫描最新模型",
      upgradeBtn: "一键升级到最新最强",
      statusUpgradable: "可升级",
      statusUpToDate: "已最新",
      statusFamilyN: "· 家族 {n} 款",
      statusSourceUnavail: "来源不可用",
      overridesTitle: "现行覆盖(可回滚到升级前):",
      rollbackBtn: "回滚",
      rollbackDefault: "(回代码默认)",
      checkedAt: "探测于",
      cachedNote: "· 缓存结果 (点「重新探测」强制刷新)",
      footer: "· 仪表盘只读各家额度,不存储/不回传任何 API Key。",
      scanFailed: "扫描失败",
      upgradeFailed: "升级失败",
      upgradeFailedLogin: "升级失败(需登录)",
      upgradeNone: "没有可升级项",
      upgradedSummary: "已升级 {n} 项:{list}{skipped} — 免重启已生效",
      upgradeSkippedNote: "({n} 项实测未过维持原值)",
      upgradeSomeSkipped: "{n} 项候选实测未通过,维持现配置",
      rolledBack: "{envKey} 已回滚",
    },
    seriesDetail: {
      statusDraft: "待生成",
      statusActive: "生成中",
      statusCompleted: "已完成",
      statusFailed: "失败·可重试",
      backLink: "返回",
      pageTitle: "系列剧 · 批量生成",
      statTotal: "共 {n} 集",
      statCompleted: "已完成 {n}",
      statGenerating: "生成中 {n}",
      statFailed: "失败 {n}",
      statPending: "待生成 {n}",
      batchGenerateBtn: "一键批量生成",
      batchGeneratePendingHint: "({n} 集待生成)",
      regenerateAll: "全部重生",
      seasonAssetsTitle: "季级产物",
      seasonCoverAlt: "季封面",
      genCoverBtn: "生成季封面",
      regenCoverBtn: "重生季封面",
      exportSeasonBtn: "导出整季合集",
      reexportSeasonBtn: "重导整季合集",
      exportFirstEpisodeHint: "先生成至少一集",
      watchSeasonVideo: "看整季合集",
      seasonVideoDesc: "合集 = 已完成各集成片按集号拼接(归一画幅 + 重编码)。",
      seasonFixBusyLabel: "⏳ 全季补渲中…",
      seasonFixLabel: "⚡ 全季补渲降级镜({n} 集受影响)",
      seasonFixProgressMsg: "第 {episode} 集补渲中({current}/{total})…",
      seasonFixDoneMsg: "全季补渲完成({n} 集),重新体检…",
      resumeStuckBtn: "🛟 恢复卡死的集(30 分钟无进展 → 重置待生成)",
      loading: "加载中…",
      noEpisodes: "该系列暂无剧集",
      episodeLabel: "第{n}集",
      healthCheckAllGreen: "体检全绿",
      shotsDowngradedLabel: "{n}镜降级",
      openEpisodeLink: "打开 →",
      loadFailStatus: "加载失败 {status},请刷新重试",
      loadFailNetwork: "加载失败,请检查网络后刷新",
      requestFailed: "请求失败",
      exportingSeasonMsg: "整季合集生成中(下载各集 + 拼接重编码,最长约 5 分钟,请勿关闭页面)…",
      exportCanceledMsg: "已取消导出 —— 可先全季补渲再导",
      exportFailedStatus: "导出失败 {status}",
      exportDoneMsg: "整季合集已生成({n} 集)",
      coverGeneratingMsg: "季封面生成中…",
      coverFailedStatus: "封面生成失败 {status}",
      coverDoneMsg: "季封面已生成",
      resumeCheckedMsg: "已检查",
      resumeFailedMsg: "恢复请求失败",
      resumeFailStatus: "失败 {status}",
      batchQueuedMsg: "已入队批量生成 {n} 集(持久队列,逐集进行中…)",
      batchStartedMsg: "已开始批量生成 {n} 集(并发 {concurrency},逐集进行中…)",
      noPendingEpisodes: "没有待生成的剧集",
      healthGateIssuePrefix: "问题集:",
      healthGateEpisodeDetail: "第{ep}集({shots}镜降级)",
      healthGateConfirmHint: "仍要导出吗?(建议先点「全季补渲降级镜」)",
      dramaPackageBtn: "📦 出海打包",
      dramaPackageFetching: "正在获取打包数据…",
      dramaPackageTitle: "出海打包 · TikTok Drama Center",
      dramaPackageDownload: "下载 JSON",
      dramaPackageCoverAlt: "系列封面",
      dramaPackageLangEpisodes: "语言:{lang} · 共 {n} 集",
      dramaPackageTotalMin: "总时长:{n} 分钟",
      dramaPackageEpFree: "免费",
      dramaPackageEpCoins: "{coins} coins",
      dramaPackageGuideTitle: "上传步骤",
      dramaPackageErrPrefix: "获取失败:",
      dramaPackageNetworkErr: "网络错误",
      dramaPackageViewVideo: "查看视频",
      dramaPackageAiDeclaration: "我确认本片由 AI 生成 / 深度合成技术制作,导出时将随包声明",
      dramaPackageAiRequiredHint: "请先勾选 AI 声明",
    },
  providerHealth: {
    ok: "正常",
    planLimited: "受限",
    outOfCredits: "额度用尽",
    authError: "鉴权失败",
    misconfigured: "配置缺失",
    down: "不可达",
    notConfigured: "未配置",
    recharge: "去充值",
    checkKey: "检查 Key",
    addConfig: "补配置",
    checkNetwork: "检查网络/服务",
    optionalSetup: "可选接入",
    upgradePlan: "换计费方式",
  },
};

const en: Translations = {
  collab: { notifTitle: 'Notifications', markAllRead: 'Mark all read', justNow: 'just now', mentioned: 'mentioned you', replied: 'replied to you', notifEmpty: 'No notifications', loginPrompt: 'Sign in to see notifications', reply: 'Reply', deleted: '[deleted]', commentPlaceholder: 'Write a comment… @ to mention', commentEmpty: 'No comments yet — be the first', send: 'Send', confirmDelete: 'Delete this comment?', demoMode: 'Demo mode', demoEnginesOff: 'engine(s) not configured', demoPlaceholder: 'generations will use placeholder assets', demoLipsyncReady: 'lip-sync render works out of the box', demoHowToEnable: 'How to enable', demoImage: 'image', demoVideo: 'video', readinessTitle: 'Engine setup', readinessReal: 'real', readinessSim: 'mock' },
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
    heroTagline1: '/ The AI short-drama production console — beyond generation',
    heroTagline2: 'Pacing audits · quality gates · character-lock consistency · AAF/EDL into your NLE · team workflow — turning "it generates" into "it ships".',
    heroEngines: 'Generation layer · plug in today\'s strongest engines (BYO key)',
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
      { q: 'Can I use generated content commercially?', a: "Copyright of generated assets belongs to the underlying engines (Kling, MiniMax, etc.). Whether you may use them commercially depends on each engine's terms of service — please verify them yourself. QingFeng only provides multi-agent orchestration and post-production tooling; it does not grant or guarantee commercial rights over generated content." },
      { q: 'How does Enterprise differ from Pro?', a: 'Enterprise supports self-hosting — deploying the full AI system on your own private servers — plus custom AI-agent development, SLA guarantees, and a dedicated customer success manager.' },
      { q: 'Can I cancel my subscription anytime?', a: 'Yes. You can cancel anytime in account settings. After canceling, you keep full access until the end of the current billing cycle.' },
    ],
    moreTitle: 'Still have questions?',
    moreDesc: 'Our team is always here to help',
    contactSupport: 'Contact Support',
    alertPayment: 'Payments are not yet integrated — this is currently free / self-hosted.',
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

    visionAudit: {
      verdictExcellent: "Excellent",
      verdictGood: "Good",
      verdictNeedsWork: "Needs Work",
      verdictPoor: "Poor",
      noDataMessage: "No quality check data yet. After generating the final video, each shot will be AI-scored on how well it matches the script.",
      panelTitle: "Quality Check · Visual vs Script",
      avgScore: "Avg Score",
      shotUnit: "Shot",
      passLabel: "Pass",
      warnLabel: "Warn",
      failLabel: "Off-script",
      weakestShotsTitle: "Priority shots (needs attention):",
      rebirthPlanPrefix: "Rebirth Plan · ",
      rebirthPlanSuffix: " weak shots suggested for reshoot",
      reshootButton: "Go to Workshop for Reshoot",
      dimScene: "Scene",
      dimAction: "Action",
      dimMood: "Mood",
      dimComposition: "Comp",
    },
    usagePage: {
      eyebrow: "Usage & Cost",
      headline: "Cost Observability",
      budgetLabel: "Monthly Budget ¥",
      budgetPlaceholder: "Unlimited",
      nearDays: "Last",
      daySuffix: "days",
      daysCostSuffix: "day spend",
      refreshTitle: "Refresh",
      loading: "Loading…",
      loadFailed: "Failed to load",
      activeAlertsBanner: "Active quota alerts · Last 1 hour",
      goBilling: "Go to billing",
      statusOk: "Budget healthy",
      statusWarn: "Near limit",
      statusOver: "Over budget",
      statusNone: "No limit set",
      alertExhausted: "Quota exhausted",
      alertSaturated: "Upstream saturated",
      alertRateLimited: "Rate limited",
      alertAuthFailed: "Auth failed",
      alertModelUnavailable: "Model unavailable",
      thisMonthBudget: "This month's budget",
      quotaTitle: "Monthly quota",
      quotaUnlimited: "Unlimited",
      quotaExceeded: "Over plan ceiling — top up or switch to an economy engine",
      quotaNearLimit: "Near plan ceiling",
      quotaOfCeiling: "plan ceiling",
      projectedEndPrefix: "Projected month-end",
      noCapSuffix: " · No cap set",
      statGenerations: "Generations",
      statEngines: "Engines",
      engineCostPrefix: "Engine spend · Last",
      engineNoData: "No cost records in this window.",
      dailyTrendTitle: "Daily cost trend",
      dailyNoData: "No daily data available.",
      countSuffix: "calls",
    },
    healthPage: {
      title: "API Health",
      subtitle: "Real-time status of models / gateways · spot quota issues and outages at a glance",
      refreshBtn: "Re-probe",
      loadFailed: "Probe failed",
      kindLlm: "LLM",
      kindTts: "TTS",
      kindVideo: "Video",
      kindImage: "Image",
      kindGateway: "Gateway",
      overallHealthy: "All Healthy",
      overallWarning: "Warning",
      overallCritical: "Outage / Overdue",
      balanceUsed: "Used",
      balanceAbundant: "Quota ample (prepaid)",
      balanceRemaining: "Remaining",
      balanceLimit: "Limit",
      radarTitle: "Model Radar",
      radarDesc: "Scan each API for the latest models · upgrade within same family only · 1-token live test for LLMs · rollback preserved · no restart needed",
      scanBtn: "Scan Latest Models",
      upgradeBtn: "Upgrade to Latest",
      statusUpgradable: "Upgradable",
      statusUpToDate: "Up to date",
      statusFamilyN: "· {n} in family",
      statusSourceUnavail: "Source unavailable",
      overridesTitle: "Active overrides (rollback available):",
      rollbackBtn: "Rollback",
      rollbackDefault: "(restore code default)",
      checkedAt: "Probed at",
      cachedNote: "· Cached result (click \"Re-probe\" to force refresh)",
      footer: "· Dashboard is read-only for quotas; no API keys stored or transmitted.",
      scanFailed: "Scan failed",
      upgradeFailed: "Upgrade failed",
      upgradeFailedLogin: "Upgrade failed (login required)",
      upgradeNone: "No upgrades available",
      upgradedSummary: "Upgraded {n} item(s): {list}{skipped} — applied without restart",
      upgradeSkippedNote: " ({n} skipped: live test failed, keeping original)",
      upgradeSomeSkipped: "{n} candidate(s) failed live test, keeping current config",
      rolledBack: "{envKey} rolled back",
    },
    seriesDetail: {
      statusDraft: "Pending",
      statusActive: "Generating",
      statusCompleted: "Completed",
      statusFailed: "Failed · Retry",
      backLink: "Back",
      pageTitle: "Series · Batch Generate",
      statTotal: "{n} episodes total",
      statCompleted: "Completed {n}",
      statGenerating: "Generating {n}",
      statFailed: "Failed {n}",
      statPending: "Pending {n}",
      batchGenerateBtn: "Batch Generate",
      batchGeneratePendingHint: "({n} pending)",
      regenerateAll: "Regenerate All",
      seasonAssetsTitle: "Season Assets",
      seasonCoverAlt: "Season Cover",
      genCoverBtn: "Generate Cover",
      regenCoverBtn: "Regenerate Cover",
      exportSeasonBtn: "Export Full Season",
      reexportSeasonBtn: "Re-export Full Season",
      exportFirstEpisodeHint: "Generate at least one episode first",
      watchSeasonVideo: "Watch Full Season",
      seasonVideoDesc: "Compilation = finished episodes concatenated in order (normalized aspect ratio + re-encoded).",
      seasonFixBusyLabel: "⏳ Fixing season…",
      seasonFixLabel: "⚡ Fix downgraded shots ({n} episode(s) affected)",
      seasonFixProgressMsg: "Fixing episode {episode} ({current}/{total})…",
      seasonFixDoneMsg: "Season fix done ({n} episodes), re-checking…",
      resumeStuckBtn: "🛟 Resume stuck episodes (no progress in 30 min → reset to pending)",
      loading: "Loading…",
      noEpisodes: "No episodes in this series",
      episodeLabel: "Ep.{n}",
      healthCheckAllGreen: "All checks passed",
      shotsDowngradedLabel: "{n} shots downgraded",
      openEpisodeLink: "Open →",
      loadFailStatus: "Load failed {status}, please refresh",
      loadFailNetwork: "Load failed, please check your network and refresh",
      requestFailed: "Request failed",
      exportingSeasonMsg: "Exporting full season (downloading episodes + concatenating & re-encoding, up to ~5 min, don't close the page)…",
      exportCanceledMsg: "Export canceled — fix downgraded shots first, then re-export",
      exportFailedStatus: "Export failed {status}",
      exportDoneMsg: "Full season exported ({n} episodes)",
      coverGeneratingMsg: "Generating season cover…",
      coverFailedStatus: "Cover generation failed {status}",
      coverDoneMsg: "Season cover generated",
      resumeCheckedMsg: "Checked",
      resumeFailedMsg: "Resume request failed",
      resumeFailStatus: "Failed {status}",
      batchQueuedMsg: "Queued {n} episodes for batch generation (persistent queue, processing one by one…)",
      batchStartedMsg: "Started batch generation for {n} episodes (concurrency {concurrency}, processing…)",
      noPendingEpisodes: "No episodes pending generation",
      healthGateIssuePrefix: "Problem episodes: ",
      healthGateEpisodeDetail: "Ep.{ep} ({shots} shots downgraded)",
      healthGateConfirmHint: "Still export? (Recommended: fix downgraded shots first)",
      dramaPackageBtn: "📦 Export Package",
      dramaPackageFetching: "Fetching package…",
      dramaPackageTitle: "Drama Package · TikTok Drama Center",
      dramaPackageDownload: "Download JSON",
      dramaPackageCoverAlt: "Series cover",
      dramaPackageLangEpisodes: "Language: {lang} · {n} episodes",
      dramaPackageTotalMin: "Total: {n} min",
      dramaPackageEpFree: "Free",
      dramaPackageEpCoins: "{coins} coins",
      dramaPackageGuideTitle: "Upload steps",
      dramaPackageErrPrefix: "Fetch failed: ",
      dramaPackageNetworkErr: "Network error",
      dramaPackageViewVideo: "View video",
      dramaPackageAiDeclaration: "I confirm this film is AI-generated / synthetic media; the declaration ships with the package",
      dramaPackageAiRequiredHint: "Please confirm the AI declaration first",
    },
  providerHealth: {
    ok: "Healthy",
    planLimited: "Plan-limited",
    outOfCredits: "Out of credits",
    authError: "Auth failed",
    misconfigured: "Misconfigured",
    down: "Unreachable",
    notConfigured: "Not configured",
    recharge: "Recharge",
    checkKey: "Check Key",
    addConfig: "Add config",
    checkNetwork: "Check network/service",
    optionalSetup: "Optional",
    upgradePlan: "Change billing",
  },
};

// v5.0: 繁体中文 (之前是 zhCN 占位)
const zhTW: Translations = {
  collab: { notifTitle: '通知', markAllRead: '全部標已讀', justNow: '剛剛', mentioned: '提到了你', replied: '回覆了你', notifEmpty: '暫無通知', loginPrompt: '登入後查看通知', reply: '回覆', deleted: '[已刪除]', commentPlaceholder: '寫評論… @ 提及他人', commentEmpty: '還沒有評論,來搶沙發', send: '發送', confirmDelete: '確認刪除這條評論?', demoMode: '示範模式', demoEnginesOff: '引擎未設定', demoPlaceholder: '生成將使用佔位 / 示意素材', demoLipsyncReady: '口型算繪已零設定可用', demoHowToEnable: '如何啟用', demoImage: '圖像生成', demoVideo: '影片生成', readinessTitle: '引擎設定', readinessReal: '真', readinessSim: '示意' },
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
    heroTagline1: '/ AI 短劇製作台 · 不止生成',
    heroTagline2: '節奏審計 · 品質門禁 · 角色鎖臉一致性 · AAF/EDL 進剪輯線 · 團隊協作 — 把「能出片」變成「能交付」',
    heroEngines: '生成層 · 接入當下最強引擎(BYO Key)',
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
    alertPayment: '付款尚未接入，目前為免費 / 自架版本。',
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
      { q: '生成的作品可以商用嗎？', a: '生成素材的版權歸屬各底層生成引擎(Kling / MiniMax 等),是否可商用取決於各引擎的服務條款,請自行核對。青楓僅提供多智能體編排與後期編輯工具,不對生成素材的商用權利作擔保。' },
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

    visionAudit: {
      verdictExcellent: "優秀",
      verdictGood: "良好",
      verdictNeedsWork: "待優化",
      verdictPoor: "需重做",
      noDataMessage: "還沒有成片質檢資料。生成成片後即可對每鏡畫面做「是否對得上劇本」的 AI 評分。",
      panelTitle: "成片質檢 · 畫面 vs 劇本",
      avgScore: "平均分",
      shotUnit: "鏡",
      passLabel: "通過",
      warnLabel: "偏差",
      failLabel: "跑題",
      weakestShotsTitle: "最需關注（優先重生）：",
      rebirthPlanPrefix: "重生計畫 · ",
      rebirthPlanSuffix: " 個弱鏡建議重拍",
      reshootButton: "一鍵去工坊重拍",
      dimScene: "場景",
      dimAction: "動作",
      dimMood: "情緒",
      dimComposition: "構圖",
    },
    usagePage: {
      eyebrow: "用量與成本",
      headline: "成本可觀測",
      budgetLabel: "月預算 ¥",
      budgetPlaceholder: "不限",
      nearDays: "近",
      daySuffix: "天",
      daysCostSuffix: "天花費",
      refreshTitle: "重新整理",
      loading: "載入中…",
      loadFailed: "載入失敗",
      activeAlertsBanner: "活躍配額告警 · 近 1 小時",
      goBilling: "前往計費",
      statusOk: "預算健康",
      statusWarn: "接近上限",
      statusOver: "已超預算",
      statusNone: "未設上限",
      alertExhausted: "額度耗盡",
      alertSaturated: "上游飽和",
      alertRateLimited: "限流",
      alertAuthFailed: "鑑權失敗",
      alertModelUnavailable: "模型不可用",
      thisMonthBudget: "本月預算",
      quotaTitle: "本月配額",
      quotaUnlimited: "無上限",
      quotaExceeded: "已超檔上限,請儲值或改用經濟引擎",
      quotaNearLimit: "接近檔上限",
      quotaOfCeiling: "檔上限",
      projectedEndPrefix: "預計月末",
      noCapSuffix: " · 未設上限",
      statGenerations: "生成次數",
      statEngines: "引擎數",
      engineCostPrefix: "引擎花費 · 近",
      engineNoData: "此視窗暫無成本記錄。",
      dailyTrendTitle: "每日成本趨勢",
      dailyNoData: "暫無每日資料。",
      countSuffix: "次",
    },
    healthPage: {
      title: "API 健康",
      subtitle: "各模型 / 閘道即時狀態 · 一眼看誰欠費或掉線",
      refreshBtn: "重新探測",
      loadFailed: "探測失敗",
      kindLlm: "大型語言模型",
      kindTts: "語音",
      kindVideo: "影片",
      kindImage: "圖像",
      kindGateway: "閘道",
      overallHealthy: "全部正常",
      overallWarning: "有警告",
      overallCritical: "有故障 / 欠費",
      balanceUsed: "已用",
      balanceAbundant: "額度充裕(儲值制)",
      balanceRemaining: "剩餘",
      balanceLimit: "上限",
      radarTitle: "模型雷達",
      radarDesc: "掃描各 API 支援的最新模型 · 同家族才升級 · LLM 先 1-token 實測 · 留回滾 · 免重啟生效",
      scanBtn: "掃描最新模型",
      upgradeBtn: "一鍵升級到最新最強",
      statusUpgradable: "可升級",
      statusUpToDate: "已最新",
      statusFamilyN: "· 家族 {n} 款",
      statusSourceUnavail: "來源不可用",
      overridesTitle: "現行覆蓋(可回滾到升級前):",
      rollbackBtn: "回滾",
      rollbackDefault: "(回程式碼預設)",
      checkedAt: "探測於",
      cachedNote: "· 快取結果 (點「重新探測」強制刷新)",
      footer: "· 儀表板僅讀取各方額度，不儲存/不回傳任何 API Key。",
      scanFailed: "掃描失敗",
      upgradeFailed: "升級失敗",
      upgradeFailedLogin: "升級失敗(需登入)",
      upgradeNone: "沒有可升級項",
      upgradedSummary: "已升級 {n} 項：{list}{skipped} — 免重啟已生效",
      upgradeSkippedNote: "（{n} 項實測未過維持原值）",
      upgradeSomeSkipped: "{n} 項候選實測未通過，維持現設定",
      rolledBack: "{envKey} 已回滾",
    },
    seriesDetail: {
      statusDraft: "待生成",
      statusActive: "生成中",
      statusCompleted: "已完成",
      statusFailed: "失敗·可重試",
      backLink: "返回",
      pageTitle: "系列劇 · 批次生成",
      statTotal: "共 {n} 集",
      statCompleted: "已完成 {n}",
      statGenerating: "生成中 {n}",
      statFailed: "失敗 {n}",
      statPending: "待生成 {n}",
      batchGenerateBtn: "一鍵批次生成",
      batchGeneratePendingHint: "({n} 集待生成)",
      regenerateAll: "全部重新生成",
      seasonAssetsTitle: "季度產出",
      seasonCoverAlt: "季封面",
      genCoverBtn: "生成季封面",
      regenCoverBtn: "重新生成季封面",
      exportSeasonBtn: "匯出整季合集",
      reexportSeasonBtn: "重新匯出整季合集",
      exportFirstEpisodeHint: "請先生成至少一集",
      watchSeasonVideo: "看整季合集",
      seasonVideoDesc: "合集 = 已完成各集成片按集號拼接（統一畫幅 + 重編碼）。",
      seasonFixBusyLabel: "⏳ 全季補渲中…",
      seasonFixLabel: "⚡ 全季補渲降級鏡（{n} 集受影響）",
      seasonFixProgressMsg: "第 {episode} 集補渲中（{current}/{total}）…",
      seasonFixDoneMsg: "全季補渲完成（{n} 集），重新體檢…",
      resumeStuckBtn: "🛟 恢復卡死的集（30 分鐘無進展 → 重置待生成）",
      loading: "載入中…",
      noEpisodes: "此系列暫無劇集",
      episodeLabel: "第{n}集",
      healthCheckAllGreen: "體檢全綠",
      shotsDowngradedLabel: "{n}鏡降級",
      openEpisodeLink: "開啟 →",
      loadFailStatus: "載入失敗 {status}，請重新整理",
      loadFailNetwork: "載入失敗，請檢查網路後重新整理",
      requestFailed: "請求失敗",
      exportingSeasonMsg: "整季合集生成中（下載各集 + 拼接重編碼，最長約 5 分鐘，請勿關閉頁面）…",
      exportCanceledMsg: "已取消匯出 —— 可先全季補渲再導",
      exportFailedStatus: "匯出失敗 {status}",
      exportDoneMsg: "整季合集已生成（{n} 集）",
      coverGeneratingMsg: "季封面生成中…",
      coverFailedStatus: "封面生成失敗 {status}",
      coverDoneMsg: "季封面已生成",
      resumeCheckedMsg: "已檢查",
      resumeFailedMsg: "恢復請求失敗",
      resumeFailStatus: "失敗 {status}",
      batchQueuedMsg: "已入隊批次生成 {n} 集（持久佇列，逐集進行中…）",
      batchStartedMsg: "已開始批次生成 {n} 集（並發 {concurrency}，逐集進行中…）",
      noPendingEpisodes: "沒有待生成的劇集",
      healthGateIssuePrefix: "問題集：",
      healthGateEpisodeDetail: "第{ep}集（{shots}鏡降級）",
      healthGateConfirmHint: "仍要匯出嗎？（建議先點「全季補渲降級鏡」）",
      dramaPackageBtn: "📦 出海打包",
      dramaPackageFetching: "正在取得打包資料…",
      dramaPackageTitle: "出海打包 · TikTok Drama Center",
      dramaPackageDownload: "下載 JSON",
      dramaPackageCoverAlt: "系列封面",
      dramaPackageLangEpisodes: "語言:{lang} · 共 {n} 集",
      dramaPackageTotalMin: "總時長:{n} 分鐘",
      dramaPackageEpFree: "免費",
      dramaPackageEpCoins: "{coins} coins",
      dramaPackageGuideTitle: "上傳步驟",
      dramaPackageErrPrefix: "取得失敗:",
      dramaPackageNetworkErr: "網路錯誤",
      dramaPackageViewVideo: "查看影片",
      dramaPackageAiDeclaration: "我確認本片由 AI 生成 / 深度合成技術製作,匯出時將隨包聲明",
      dramaPackageAiRequiredHint: "請先勾選 AI 聲明",
    },
  providerHealth: {
    ok: "正常",
    planLimited: "受限",
    outOfCredits: "額度用盡",
    authError: "鑑權失敗",
    misconfigured: "配置缺失",
    down: "不可達",
    notConfigured: "未配置",
    recharge: "去儲值",
    checkKey: "檢查 Key",
    addConfig: "補配置",
    checkNetwork: "檢查網路/服務",
    optionalSetup: "可選接入",
    upgradePlan: "換計費方式",
  },
};

// v5.0: 日本語 (之前是 zhCN 占位)
const ja: Translations = {
  collab: { notifTitle: '通知', markAllRead: 'すべて既読', justNow: 'たった今', mentioned: 'メンションされました', replied: '返信されました', notifEmpty: '通知はありません', loginPrompt: 'ログインして通知を表示', reply: '返信', deleted: '[削除済み]', commentPlaceholder: 'コメントを入力… @ でメンション', commentEmpty: 'まだコメントはありません', send: '送信', confirmDelete: 'このコメントを削除しますか?', demoMode: 'デモモード', demoEnginesOff: 'エンジン未設定', demoPlaceholder: '生成にはプレースホルダー素材を使用します', demoLipsyncReady: 'リップシンクはゼロ設定で利用可能', demoHowToEnable: '有効化の方法', demoImage: '画像生成', demoVideo: '動画生成', readinessTitle: 'エンジン設定', readinessReal: '実', readinessSim: 'モック' },
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
    heroTagline1: '/ AIショートドラマ制作コンソール — 生成のその先へ',
    heroTagline2: 'テンポ監査 · 品質ゲート · キャラ顔ロック一貫性 · AAF/EDLでNLEへ · チーム協業 — 「作れる」を「納品できる」に。',
    heroEngines: '生成レイヤー · 最強エンジンを接続(BYOキー)',
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
      { q: '生成したコンテンツは商用利用できますか？', a: '生成された素材の著作権は各基盤エンジン(Kling / MiniMax 等)に帰属します。商用利用の可否は各エンジンの利用規約によりますので、必ずご自身でご確認ください。青楓はマルチエージェントの編集・後処理ツールを提供するのみで、生成物の商用権利を保証するものではありません。' },
      { q: '企業版とプロ版の主な違いは？', a: '企業版はセルフホストに対応し、AIシステム一式を自社のプライベートサーバーに導入できます。さらにカスタムAIエージェント開発、SLA保証、専任のカスタマーサクセスマネージャーが付きます。' },
      { q: 'いつでも解約できますか？', a: 'はい。アカウント設定からいつでも解約できます。解約後も、現在の請求期間の終了までは全機能を利用できます。' },
    ],
    moreTitle: '他にご質問は？',
    moreDesc: '私たちのチームがいつでもお答えします',
    contactSupport: 'サポートに連絡',
    alertPayment: '決済は未導入です。現在は無料 / セルフホスト版です。',
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
      { q: '生成した作品は商用利用できますか？', a: '生成物の著作権は各生成エンジンに帰属します。商用利用の可否は各エンジンの規約をご確認ください。青楓は編集・後処理ツールを提供するのみです。' },
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

    visionAudit: {
      verdictExcellent: "優秀",
      verdictGood: "良好",
      verdictNeedsWork: "要改善",
      verdictPoor: "要やり直し",
      noDataMessage: "まだ品質チェックデータがありません。完成動画を生成した後、各ショットが脚本と一致しているかAI評価されます。",
      panelTitle: "品質チェック · 映像 vs 脚本",
      avgScore: "平均スコア",
      shotUnit: "ショット",
      passLabel: "合格",
      warnLabel: "警告",
      failLabel: "不一致",
      weakestShotsTitle: "要注意（優先的に再生成）：",
      rebirthPlanPrefix: "再生成プラン · ",
      rebirthPlanSuffix: "個の弱ショットを再撮影推奨",
      reshootButton: "ワークショップで再撮影",
      dimScene: "シーン",
      dimAction: "アクション",
      dimMood: "雰囲気",
      dimComposition: "構図",
    },
    usagePage: {
      eyebrow: "使用量とコスト",
      headline: "コスト可観測性",
      budgetLabel: "月次予算 ¥",
      budgetPlaceholder: "上限なし",
      nearDays: "過去",
      daySuffix: "日間",
      daysCostSuffix: "日間の費用",
      refreshTitle: "更新",
      loading: "読み込み中…",
      loadFailed: "読み込みに失敗しました",
      activeAlertsBanner: "アクティブなクォータアラート · 過去1時間",
      goBilling: "請求へ",
      statusOk: "予算は正常",
      statusWarn: "上限に近づいています",
      statusOver: "予算超過",
      statusNone: "上限未設定",
      alertExhausted: "クォータ枯渇",
      alertSaturated: "上流が飽和",
      alertRateLimited: "レート制限中",
      alertAuthFailed: "認証失敗",
      alertModelUnavailable: "モデル利用不可",
      thisMonthBudget: "今月の予算",
      quotaTitle: "今月のクォータ",
      quotaUnlimited: "無制限",
      quotaExceeded: "プラン上限を超過 — チャージまたは低コストエンジンへ",
      quotaNearLimit: "プラン上限に接近",
      quotaOfCeiling: "プラン上限",
      projectedEndPrefix: "月末予測",
      noCapSuffix: " · 上限なし",
      statGenerations: "生成回数",
      statEngines: "エンジン数",
      engineCostPrefix: "エンジン費用 · 過去",
      engineNoData: "この期間のコスト記録はありません。",
      dailyTrendTitle: "日次コスト推移",
      dailyNoData: "日次データがありません。",
      countSuffix: "回",
    },
    healthPage: {
      title: "API ヘルス",
      subtitle: "モデル / ゲートウェイのリアルタイム状態 · 残高切れや障害を一目で確認",
      refreshBtn: "再プローブ",
      loadFailed: "プローブ失敗",
      kindLlm: "大規模言語モデル",
      kindTts: "音声",
      kindVideo: "動画",
      kindImage: "画像",
      kindGateway: "ゲートウェイ",
      overallHealthy: "すべて正常",
      overallWarning: "警告あり",
      overallCritical: "障害 / 残高不足",
      balanceUsed: "使用済み",
      balanceAbundant: "残高十分（チャージ制）",
      balanceRemaining: "残高",
      balanceLimit: "上限",
      radarTitle: "モデルレーダー",
      radarDesc: "各 API の最新モデルをスキャン · 同ファミリーのみアップグレード · LLM は 1 トークン実検証 · ロールバック保持 · 再起動不要で反映",
      scanBtn: "最新モデルをスキャン",
      upgradeBtn: "最新最強にアップグレード",
      statusUpgradable: "アップグレード可能",
      statusUpToDate: "最新",
      statusFamilyN: "· ファミリー {n} モデル",
      statusSourceUnavail: "ソース利用不可",
      overridesTitle: "現在の上書き（アップグレード前にロールバック可能）:",
      rollbackBtn: "ロールバック",
      rollbackDefault: "（コードデフォルトに戻す）",
      checkedAt: "プローブ時刻:",
      cachedNote: "· キャッシュ結果（「再プローブ」で強制更新）",
      footer: "· ダッシュボードは残高の読み取り専用です。API キーは保存・送信されません。",
      scanFailed: "スキャン失敗",
      upgradeFailed: "アップグレード失敗",
      upgradeFailedLogin: "アップグレード失敗（ログインが必要）",
      upgradeNone: "アップグレード対象なし",
      upgradedSummary: "{n} 件アップグレード：{list}{skipped} — 再起動なしで反映済み",
      upgradeSkippedNote: "（{n} 件は実検証未通過のため元の値を維持）",
      upgradeSomeSkipped: "{n} 件の候補が実検証未通過。現在の設定を維持します",
      rolledBack: "{envKey} をロールバックしました",
    },
    seriesDetail: {
      statusDraft: "未生成",
      statusActive: "生成中",
      statusCompleted: "完了",
      statusFailed: "失敗・再試行可",
      backLink: "戻る",
      pageTitle: "シリーズ · 一括生成",
      statTotal: "全 {n} 話",
      statCompleted: "完了 {n}",
      statGenerating: "生成中 {n}",
      statFailed: "失敗 {n}",
      statPending: "未生成 {n}",
      batchGenerateBtn: "一括生成",
      batchGeneratePendingHint: "({n} 話待ち)",
      regenerateAll: "すべて再生成",
      seasonAssetsTitle: "シーズン成果物",
      seasonCoverAlt: "シーズンカバー",
      genCoverBtn: "カバー生成",
      regenCoverBtn: "カバー再生成",
      exportSeasonBtn: "フルシーズンを書き出す",
      reexportSeasonBtn: "フルシーズン再書き出し",
      exportFirstEpisodeHint: "先に少なくとも1話を生成してください",
      watchSeasonVideo: "フルシーズンを見る",
      seasonVideoDesc: "コンピレーション = 完了した各話を話数順に結合（アスペクト比統一 + 再エンコード）。",
      seasonFixBusyLabel: "⏳ シーズン修正中…",
      seasonFixLabel: "⚡ ダウングレードショット修正（{n} 話に影響）",
      seasonFixProgressMsg: "第 {episode} 話補正中（{current}/{total}）…",
      seasonFixDoneMsg: "シーズン修正完了（{n} 話）、再チェック中…",
      resumeStuckBtn: "🛟 停止した話を再開（30分間進捗なし → 保留にリセット）",
      loading: "読み込み中…",
      noEpisodes: "このシリーズにはエピソードがありません",
      episodeLabel: "第{n}話",
      healthCheckAllGreen: "全チェック通過",
      shotsDowngradedLabel: "{n}ショット降格",
      openEpisodeLink: "開く →",
      loadFailStatus: "読み込み失敗 {status}、更新してください",
      loadFailNetwork: "読み込み失敗、ネットワークを確認して更新してください",
      requestFailed: "リクエストに失敗しました",
      exportingSeasonMsg: "フルシーズン書き出し中（各話をダウンロード + 結合・再エンコード、最大約5分、ページを閉じないでください）…",
      exportCanceledMsg: "書き出しをキャンセルしました — 先にダウングレードショットを修正してから再書き出し",
      exportFailedStatus: "書き出し失敗 {status}",
      exportDoneMsg: "フルシーズン書き出し完了（{n} 話）",
      coverGeneratingMsg: "シーズンカバー生成中…",
      coverFailedStatus: "カバー生成失敗 {status}",
      coverDoneMsg: "シーズンカバーが生成されました",
      resumeCheckedMsg: "確認済み",
      resumeFailedMsg: "再開リクエストに失敗しました",
      resumeFailStatus: "失敗 {status}",
      batchQueuedMsg: "{n} 話をキューに追加（永続キュー、1話ずつ処理中…）",
      batchStartedMsg: "{n} 話の一括生成を開始（並列数 {concurrency}、処理中…）",
      noPendingEpisodes: "生成待ちのエピソードはありません",
      healthGateIssuePrefix: "問題の話：",
      healthGateEpisodeDetail: "第{ep}話（{shots}ショット降格）",
      healthGateConfirmHint: "それでも書き出しますか？（先に「ダウングレードショット修正」を推奨）",
      dramaPackageBtn: "📦 海外パッケージ",
      dramaPackageFetching: "パッケージ取得中…",
      dramaPackageTitle: "海外パッケージ · TikTok Drama Center",
      dramaPackageDownload: "JSON ダウンロード",
      dramaPackageCoverAlt: "シリーズカバー",
      dramaPackageLangEpisodes: "言語:{lang} · 全 {n} 話",
      dramaPackageTotalMin: "合計:{n} 分",
      dramaPackageEpFree: "無料",
      dramaPackageEpCoins: "{coins} coins",
      dramaPackageGuideTitle: "アップロード手順",
      dramaPackageErrPrefix: "取得失敗:",
      dramaPackageNetworkErr: "ネットワークエラー",
      dramaPackageViewVideo: "動画を見る",
      dramaPackageAiDeclaration: "本作品が AI 生成 / 深度合成技術で制作されたことを確認します(パッケージに声明を同梱)",
      dramaPackageAiRequiredHint: "先に AI 声明にチェックしてください",
    },
  providerHealth: {
    ok: "正常",
    planLimited: "プラン制限",
    outOfCredits: "残高切れ",
    authError: "認証失敗",
    misconfigured: "設定不足",
    down: "到達不可",
    notConfigured: "未設定",
    recharge: "チャージ",
    checkKey: "キー確認",
    addConfig: "設定追加",
    checkNetwork: "ネット/サービス確認",
    optionalSetup: "任意接続",
    upgradePlan: "課金方式を変更",
  },
};


// v12.213:ko/ru 全量文案包(workflow 翻译,深度合并 en 保证类型完整)
const ko: Translations = {
  "collab": {
    "notifTitle": "알림",
    "markAllRead": "모두 읽음 처리",
    "justNow": "방금",
    "mentioned": "회원님을 언급했습니다",
    "replied": "회원님에게 답글을 달았습니다",
    "notifEmpty": "알림이 없습니다",
    "loginPrompt": "로그인하면 알림을 볼 수 있습니다",
    "reply": "답글",
    "deleted": "[삭제됨]",
    "commentPlaceholder": "댓글 작성… @으로 멘션",
    "commentEmpty": "아직 댓글이 없습니다 — 첫 번째로 남겨보세요",
    "send": "전송",
    "confirmDelete": "이 댓글을 삭제할까요?",
    "demoMode": "데모 모드",
    "demoEnginesOff": "엔진이 설정되지 않음",
    "demoPlaceholder": "생성 시 자리 표시 에셋이 사용됩니다",
    "demoLipsyncReady": "립싱크 렌더링이 바로 사용 가능합니다",
    "demoHowToEnable": "활성화 방법",
    "demoImage": "이미지",
    "demoVideo": "비디오",
    "readinessTitle": "엔진 설정",
    "readinessReal": "실제",
    "readinessSim": "모의"
  },
  "common": {
    "create": "만들기",
    "save": "저장",
    "cancel": "취소",
    "delete": "삭제",
    "edit": "편집",
    "share": "공유",
    "download": "다운로드",
    "loading": "로딩 중...",
    "error": "오류",
    "success": "성공",
    "viewAll": "전체 보기",
    "backHome": "홈으로",
    "saveChanges": "변경 저장",
    "saving": "저장 중...",
    "reset": "초기화"
  },
  "brand": {
    "studio": "AI 만화 스튜디오"
  },
  "nav": {
    "home": "홈",
    "projects": "내 프로젝트",
    "create": "만들기",
    "pricing": "요금제",
    "profile": "프로필",
    "settings": "설정",
    "polish": "스크립트 다듬기",
    "workbench": "작업대",
    "cases": "쇼케이스",
    "userCenter": "대시보드",
    "newProject": "새 프로젝트"
  },
  "create": {
    "badge": "AI 창작 스튜디오",
    "title": "창작 여정을 시작하세요",
    "subtitle": "스토리 아이디어를 입력하면 AI 팀이 완성된 만화 드라마를 만들어 드립니다",
    "ideaLabel": "스토리 아이디어",
    "ideaPlaceholder": "예: 시간 여행자의 사랑 이야기...",
    "videoProviderLabel": "비디오 생성 엔진",
    "startButton": "창작 시작"
  },
  "projects": {
    "title": "내 프로젝트",
    "subtitle": "AI 만화 드라마 창작물을 모두 관리하세요",
    "searchPlaceholder": "프로젝트 제목 또는 설명 검색...",
    "filterAll": "전체",
    "filterCompleted": "완료",
    "filterCreating": "제작 중",
    "filterFailed": "실패",
    "noResults": "일치하는 프로젝트가 없습니다",
    "createNew": "새 프로젝트 만들기",
    "shotsUnit": "컷"
  },
  "dashboard": {
    "systemOnline": "시스템 온라인",
    "title": "창작 현황",
    "subtitle": "멀티 에이전트 AI 엔진 — 아이디어에서 완성작까지 원스톱 만화 제작 라인",
    "quickStartTitle": "창작 시작",
    "quickStartSubtitle": "아이디어를 입력하면 7인 AI 팀이 제작합니다",
    "statProjects": "내 프로젝트",
    "statProjectsSub": "진행 중인 만화 프로젝트",
    "statGenerations": "생성 횟수",
    "statGenerationsSub": "AI 생성 총 호출 수",
    "statCases": "쇼케이스",
    "statCasesSub": "참고 템플릿 케이스",
    "recentCreations": "최근 창작물",
    "noRecords": "아직 창작물이 없습니다",
    "startFirst": "첫 번째 창작 시작하기 →",
    "systemStatus": "시스템 상태",
    "recentActivity": "최근 활동",
    "statusCompleted": "완료",
    "statusCreating": "제작 중",
    "statusDraft": "초안"
  },
  "settings": {
    "title": "설정",
    "subtitle": "앱 환경설정 및 계정 설정을 관리하세요",
    "general": "일반",
    "generalDesc": "언어 및 지역 설정",
    "language": "언어",
    "appearance": "외관",
    "appearanceDesc": "인터페이스 테마 변경",
    "theme": "테마",
    "themeDark": "다크",
    "themeLight": "라이트",
    "themeAuto": "시스템 기본값",
    "notifications": "알림",
    "notificationsDesc": "알림 설정 관리",
    "projectDone": "프로젝트 완료 알림",
    "projectDoneDesc": "프로젝트가 완료되면 알림을 받습니다",
    "performance": "성능",
    "performanceDesc": "앱 성능 최적화",
    "videoQuality": "비디오 품질",
    "qualityHigh": "고화질",
    "qualityMedium": "중간",
    "qualityLow": "저화질 (데이터 절약)",
    "privacy": "개인정보 및 보안",
    "privacyDesc": "계정을 안전하게 보호하세요",
    "changePassword": "비밀번호 변경",
    "enable2fa": "2단계 인증 활성화",
    "manageDevices": "로그인된 기기 관리",
    "billing": "청구 및 구독",
    "billingDesc": "구독 플랜 관리",
    "freePlan": "무료 플랜",
    "currentPlan": "현재 플랜",
    "freeQuota": "월 10개 프로젝트",
    "upgradePro": "Pro로 업그레이드",
    "saved": "설정이 저장되었습니다",
    "savedDesc": "환경설정이 업데이트되었습니다",
    "resetDone": "설정이 초기화되었습니다"
  },
  "profile": {
    "title": "프로필",
    "subtitle": "개인 정보 및 환경설정을 관리하세요",
    "avatar": "아바타",
    "uploadAvatar": "아바타 업로드",
    "basicInfo": "기본 정보",
    "basicInfoDesc": "프로필을 업데이트하세요",
    "username": "사용자 이름",
    "email": "이메일",
    "bio": "소개",
    "bioPlaceholder": "자기소개를 입력하세요...",
    "stats": "창작 통계",
    "totalProjects": "총 프로젝트",
    "inProgress": "진행 중",
    "totalShots": "총 컷 수",
    "saveSuccess": "저장됨",
    "saveSuccessDesc": "프로필이 업데이트되었습니다",
    "role": "역할",
    "accountPrefs": "계정 및 환경설정",
    "visualPref": "시각적 환경설정",
    "collabSpace": "협업 공간"
  },
  "billing": {
    "title": "구독 관리",
    "currentTier": "현재 플랜: ",
    "paymentNote": "Stripe Checkout으로 결제; 취소 또는 카드 변경은 Stripe Customer Portal에서 진행",
    "recommended": "추천",
    "currentBadge": "현재",
    "contactUs": "문의하기",
    "perMonth": "/월",
    "alreadyThis": "현재 플랜",
    "freeNoPurchase": "무료 · 구매 불필요",
    "businessTalk": "영업팀 문의",
    "upgradeTo": "업그레이드:",
    "portalNote": "Stripe Customer Portal에서 업그레이드, 다운그레이드, 취소 또는 결제 수단 변경; 자체 호스팅 시 STRIPE_PORTAL_LINK 설정 필요.",
    "openPortal": "Stripe Customer Portal 열기",
    "checkoutFailed": "결제 실패",
    "paymentCanceled": "결제가 취소되었습니다",
    "upgradedPrefix": "업그레이드 완료:",
    "upgradedSuffix": "! 구독이 활성화되었습니다"
  },
  "cases": {
    "title": "쇼케이스",
    "titlePublic": "추천 케이스",
    "subtitle": "QingFeng 파트너 및 크리에이터의 작품",
    "subtitleReuse": "QingFeng 파트너 및 크리에이터 · 클릭하여 아이디어 재사용",
    "copyPrompt": "프롬프트 복사",
    "copied": "복사됨",
    "usePrompt": "이걸로 만들기"
  },
  "home": {
    "heroTagline1": "/ AI 단편 드라마 제작 콘솔 — 생성을 넘어서",
    "heroTagline2": "페이싱 감사 · 품질 게이트 · 캐릭터 일관성 고정 · AAF/EDL로 편집 라인 연동 · 팀 워크플로우 — \"생성된다\"를 \"완성된다\"로",
    "heroEngines": "생성 레이어 · 최강 엔진 직접 연결 (BYO Key)",
    "heroCtaCreate": "창작 시작 →",
    "heroCtaCases": "작품 보기",
    "featureTitle": "영화감독처럼 페이싱을 지휘하세요",
    "featureSubtitle": "스크립트, 스토리보드, 애니메이션, 음향 전반의 시각적 협업 워크플로우",
    "agentsTitle": "AI 애니메이션 에이전트 팀",
    "agentsSubtitle": "모든 역할이 실시간으로 협업합니다",
    "lensCaption": "렌즈 박스: 카메라 움직임, 초점 거리, 앵글 커스텀",
    "lensTitle": "모든 프레임에 통일된 시네마틱 언어",
    "lensDesc": "일관된 스타일, 색감, 카메라 무빙 규칙",
    "frameTitle": "AI가 빠르게 생성하는 스토리보드",
    "frameSubtitle": "한 문장에서 편집 가능한 멀티 컷 시퀀스까지",
    "frameSteps": [{
        "title": "스크립트 구조",
        "desc": "스토리 페이싱 스마트 파싱"
      }, {
        "title": "컷 분해",
        "desc": "멀티 컷 스토리보드 자동 생성"
      }, {
        "title": "캐릭터 설정",
        "desc": "캐릭터와 스타일 일관성 유지"
      }],
    "frameCta": "스토리보드 생성",
    "vibeKicker": "무드 보드: 실시간 비주얼·오디오 업데이트",
    "vibeTitle": "실시간으로 무드와 리듬 미리보기",
    "vibeDesc": "비주얼, 카메라, 음악이 함께 감정을 이끕니다",
    "casesTitle": "추천 케이스",
    "casesSubtitle": "QingFeng 파트너 및 크리에이터의 작품",
    "casesTryNow": "지금 체험",
    "ctaTitle": "스토리를 애니메이션으로",
    "ctaDesc": "지금 바로 첫 AI 만화 드라마를 시작하세요",
    "ctaButton": "작업대 입장"
  },
  "pricing": {
    "enterWorkbench": "작업대 입장",
    "badge": "요금제",
    "titleLead": "나에게 맞는 ",
    "titleHighlight": "플랜을 선택하세요",
    "subtitle": "무료 체험부터 기업 자체 호스팅까지, QingFeng이 모든 크리에이터에게 최적의 AI 만화 제작 플랜을 제공합니다",
    "custom": "맞춤형",
    "customNote": "견적 요청, 영업팀 문의",
    "free": "무료",
    "startUsing": "시작하기",
    "apiAccess": "API 액세스",
    "commercialLicense": "상업용 라이선스",
    "footnote": "모든 플랜 포함: 24/7 AI 엔진 지원 · 결제 즉시 적용 · 언제든 취소 가능",
    "faqTitle": "자주 묻는 질문",
    "faq": [{
        "q": "무료 플랜의 제한 사항은 무엇인가요?",
        "a": "무료 플랜은 월 3개 프로젝트, 캐릭터 라이브러리 최대 5개, 720p 비디오 내보내기, QingFeng 워터마크가 포함됩니다. 개인 체험에 적합합니다."
      }, {
        "q": "업그레이드 후 바로 새 기능을 사용할 수 있나요?",
        "a": "네. 결제가 완료되면 해당 플랜 혜택이 즉시 활성화됩니다 — 검토 대기 없습니다."
      }, {
        "q": "Pro 상업용 라이선스는 어디까지 적용되나요?",
        "a": "Pro 상업용 라이선스를 통해 QingFeng으로 생성한 콘텐츠를 광고, 브랜딩, 영상 배급 등 상업 목적으로 사용할 수 있습니다. 단, 소스 모델 재훈련 권리는 포함되지 않습니다."
      }, {
        "q": "Enterprise와 Pro의 차이점은 무엇인가요?",
        "a": "Enterprise는 자체 호스팅을 지원합니다 — 전체 AI 시스템을 자체 프라이빗 서버에 배포하고, 맞춤 AI 에이전트 개발, SLA 보장, 전담 고객 성공 매니저 서비스가 포함됩니다."
      }, {
        "q": "구독을 언제든 취소할 수 있나요?",
        "a": "네. 계정 설정에서 언제든 취소할 수 있습니다. 취소 후 현재 결제 주기가 끝날 때까지 모든 기능을 이용할 수 있습니다."
      }],
    "moreTitle": "더 궁금한 점이 있나요?",
    "moreDesc": "팀이 언제든 도움을 드립니다",
    "contactSupport": "고객 지원 문의",
    "alertPayment": "결제는 아직 연동되지 않았습니다 — 현재 무료 / 셀프 호스팅입니다."
  },
  "help": {
    "examples": "예시 작품",
    "title": "도움말 센터",
    "subtitle": "AI 만화 창작에 필요한 답을 찾고 시작하세요",
    "searchPlaceholder": "도움말 검색...",
    "quickGuides": "빠른 가이드",
    "guides": [{
        "title": "빠른 시작",
        "description": "5분 만에 첫 AI 만화 드라마 만들기"
      }, {
        "title": "창작 가이드",
        "description": "AI 만화 창작 기술과 모범 사례 익히기"
      }, {
        "title": "커뮤니티 튜토리얼",
        "description": "크리에이터 커뮤니티가 공유하는 팁"
      }],
    "faqTitle": "자주 묻는 질문",
    "faqs": [{
        "q": "첫 프로젝트는 어떻게 시작하나요?",
        "a": "\"창작 시작\"을 클릭하고 스토리 아이디어를 입력한 뒤 비디오 엔진을 선택하면 AI가 완성된 만화 드라마를 생성합니다."
      }, {
        "q": "지원하는 비디오 엔진은 무엇인가요?",
        "a": "Minimax, Vidu, Kling AI 등 여러 엔진을 지원합니다 — 필요에 맞는 엔진을 선택하세요."
      }, {
        "q": "프로젝트 생성에 얼마나 걸리나요?",
        "a": "보통 5~15분 정도이며, 프로젝트 복잡도와 선택한 비디오 엔진에 따라 다릅니다."
      }, {
        "q": "AI가 생성한 콘텐츠를 편집할 수 있나요?",
        "a": "네 — 스크립트 편집, 캐릭터 디자인 조정, 스토리보드 수정이 가능합니다. 창작 과정을 완전히 제어할 수 있습니다."
      }, {
        "q": "작품을 상업적으로 사용할 수 있나요?",
        "a": "생성된 자산의 저작권은 각 기반 엔진(Kling / MiniMax 등)에 귀속됩니다. 상업적 사용 가능 여부는 각 엔진의 이용약관에 따르므로 반드시 직접 확인하세요. QingFeng은 멀티 에이전트 편집·후처리 도구만 제공하며 생성물의 상업적 권리를 보장하지 않습니다."
      }, {
        "q": "작품을 어떻게 내보내나요?",
        "a": "프로젝트 상세 페이지에서 \"다운로드\"를 클릭하면 비디오, 이미지, 스크립트 및 모든 에셋을 내보낼 수 있습니다."
      }],
    "moreTitle": "더 궁금한 점이 있나요?",
    "moreDesc": "지원팀이 언제든 도움을 드릴 준비가 되어 있습니다",
    "sendEmail": "이메일 보내기",
    "liveChat": "실시간 채팅"
  },
  "examples": {
    "title": "추천 작품",
    "subtitle": "AI가 만든 멋진 만화 드라마를 탐험해 보세요",
    "ctaTitle": "나만의 작품을 만들 준비가 되셨나요?",
    "ctaDesc": "수천 명의 크리에이터와 함께 AI 만화 여정을 시작하세요",
    "ctaButton": "지금 창작 시작"
  },
  "visionAudit": {
    "verdictExcellent": "우수",
    "verdictGood": "양호",
    "verdictNeedsWork": "개선 필요",
    "verdictPoor": "미흡",
    "noDataMessage": "아직 품질 검사 데이터가 없습니다. 최종 영상 생성 후 각 컷이 스크립트와 얼마나 일치하는지 AI가 채점합니다.",
    "panelTitle": "품질 검사 · 비주얼 vs 스크립트",
    "avgScore": "평균 점수",
    "shotUnit": "컷",
    "passLabel": "통과",
    "warnLabel": "경고",
    "failLabel": "이탈",
    "weakestShotsTitle": "우선 처리 컷 (주의 필요):",
    "rebirthPlanPrefix": "재생성 계획 · ",
    "rebirthPlanSuffix": "개 약한 컷 재촬영 권장",
    "reshootButton": "워크샵에서 재촬영하기",
    "dimScene": "장면",
    "dimAction": "액션",
    "dimMood": "무드",
    "dimComposition": "구도"
  },
  "usagePage": {
    "eyebrow": "사용량 및 비용",
    "headline": "비용 가시성",
    "budgetLabel": "월 예산 ¥",
    "budgetPlaceholder": "무제한",
    "nearDays": "최근",
    "daySuffix": "일",
    "daysCostSuffix": "일 지출",
    "refreshTitle": "새로고침",
    "loading": "로딩 중…",
    "loadFailed": "로드 실패",
    "activeAlertsBanner": "활성 할당량 알림 · 최근 1시간",
    "goBilling": "청구로 이동",
    "statusOk": "예산 양호",
    "statusWarn": "한도 근접",
    "statusOver": "예산 초과",
    "statusNone": "한도 미설정",
    "alertExhausted": "할당량 소진",
    "alertSaturated": "업스트림 포화",
    "alertRateLimited": "속도 제한",
    "alertAuthFailed": "인증 실패",
    "alertModelUnavailable": "모델 사용 불가",
    "thisMonthBudget": "이번 달 예산",
    "quotaTitle": "이번 달 할당량",
    "quotaUnlimited": "무제한",
    "quotaExceeded": "플랜 상한 초과 — 충전 또는 경제형 엔진으로 전환",
    "quotaNearLimit": "플랜 상한 근접",
    "quotaOfCeiling": "플랜 상한",
    "projectedEndPrefix": "예상 월말 지출",
    "noCapSuffix": " · 한도 미설정",
    "statGenerations": "생성 횟수",
    "statEngines": "엔진 수",
    "engineCostPrefix": "엔진 지출 · 최근",
    "engineNoData": "이 기간에 비용 기록이 없습니다.",
    "dailyTrendTitle": "일별 비용 추이",
    "dailyNoData": "일별 데이터가 없습니다.",
    "countSuffix": "회"
  },
  "healthPage": {
    "title": "API 상태",
    "subtitle": "모델 / 게이트웨이 실시간 상태 · 할당량 문제와 장애를 한눈에",
    "refreshBtn": "재탐색",
    "loadFailed": "탐색 실패",
    "kindLlm": "LLM",
    "kindTts": "TTS",
    "kindVideo": "비디오",
    "kindImage": "이미지",
    "kindGateway": "게이트웨이",
    "overallHealthy": "모두 정상",
    "overallWarning": "경고",
    "overallCritical": "장애 / 요금 미납",
    "balanceUsed": "사용됨",
    "balanceAbundant": "충분한 할당량 (선불)",
    "balanceRemaining": "잔여",
    "balanceLimit": "한도",
    "radarTitle": "모델 레이더",
    "radarDesc": "각 API에서 최신 모델 스캔 · 동일 계열만 업그레이드 · LLM 1토큰 실 테스트 · 롤백 보존 · 재시작 불필요",
    "scanBtn": "최신 모델 스캔",
    "upgradeBtn": "최신 버전으로 업그레이드",
    "statusUpgradable": "업그레이드 가능",
    "statusUpToDate": "최신 상태",
    "statusFamilyN": "· 계열 {n}개",
    "statusSourceUnavail": "소스 사용 불가",
    "overridesTitle": "현재 적용 중 (롤백 가능):",
    "rollbackBtn": "롤백",
    "rollbackDefault": "(코드 기본값 복원)",
    "checkedAt": "탐색 시각",
    "cachedNote": "· 캐시된 결과 (\"재탐색\" 클릭 시 강제 새로고침)",
    "footer": "· 대시보드는 할당량 읽기 전용으로 API 키를 저장하거나 전송하지 않습니다.",
    "scanFailed": "스캔 실패",
    "upgradeFailed": "업그레이드 실패",
    "upgradeFailedLogin": "업그레이드 실패 (로그인 필요)",
    "upgradeNone": "업그레이드 가능한 항목 없음",
    "upgradedSummary": "{n}개 항목 업그레이드: {list}{skipped} — 재시작 없이 적용됨",
    "upgradeSkippedNote": " ({n}개 건너뜀: 실 테스트 실패, 기존값 유지)",
    "upgradeSomeSkipped": "{n}개 후보 실 테스트 실패, 현재 설정 유지",
    "rolledBack": "{envKey} 롤백 완료"
  },
  "seriesDetail": {
    "statusDraft": "대기 중",
    "statusActive": "생성 중",
    "statusCompleted": "완료",
    "statusFailed": "실패 · 재시도",
    "backLink": "뒤로",
    "pageTitle": "시리즈 · 일괄 생성",
    "statTotal": "총 {n}화",
    "statCompleted": "완료 {n}",
    "statGenerating": "생성 중 {n}",
    "statFailed": "실패 {n}",
    "statPending": "대기 {n}",
    "batchGenerateBtn": "일괄 생성",
    "batchGeneratePendingHint": "({n}화 대기 중)",
    "regenerateAll": "전체 재생성",
    "seasonAssetsTitle": "시즌 에셋",
    "seasonCoverAlt": "시즌 커버",
    "genCoverBtn": "커버 생성",
    "regenCoverBtn": "커버 재생성",
    "exportSeasonBtn": "전 시즌 내보내기",
    "reexportSeasonBtn": "전 시즌 재내보내기",
    "exportFirstEpisodeHint": "에피소드를 하나 이상 먼저 생성하세요",
    "watchSeasonVideo": "전 시즌 보기",
    "seasonVideoDesc": "컴필레이션 = 완성된 에피소드를 순서대로 연결한 것 (화면 비율 통일 + 재인코딩)",
    "seasonFixBusyLabel": "⏳ 시즌 수정 중…",
    "seasonFixLabel": "⚡ 다운그레이드된 컷 수정 ({n}화 영향)",
    "seasonFixProgressMsg": "{episode}화 수정 중 ({current}/{total})…",
    "seasonFixDoneMsg": "시즌 수정 완료 ({n}화), 재검사 중…",
    "resumeStuckBtn": "🛟 중단된 에피소드 재개 (30분 진행 없음 → 대기 중으로 초기화)",
    "loading": "로딩 중…",
    "noEpisodes": "이 시리즈에 에피소드가 없습니다",
    "episodeLabel": "{n}화",
    "healthCheckAllGreen": "모든 검사 통과",
    "shotsDowngradedLabel": "{n}컷 다운그레이드됨",
    "openEpisodeLink": "열기 →",
    "loadFailStatus": "로드 실패 {status}, 새로고침해 주세요",
    "loadFailNetwork": "로드 실패, 네트워크를 확인하고 새로고침해 주세요",
    "requestFailed": "요청 실패",
    "exportingSeasonMsg": "전 시즌 내보내는 중 (에피소드 다운로드 + 연결 및 재인코딩, 최대 ~5분, 페이지를 닫지 마세요)…",
    "exportCanceledMsg": "내보내기 취소됨 — 다운그레이드된 컷을 먼저 수정한 뒤 재내보내기하세요",
    "exportFailedStatus": "내보내기 실패 {status}",
    "exportDoneMsg": "전 시즌 내보내기 완료 ({n}화)",
    "coverGeneratingMsg": "시즌 커버 생성 중…",
    "coverFailedStatus": "커버 생성 실패 {status}",
    "coverDoneMsg": "시즌 커버 생성 완료",
    "resumeCheckedMsg": "확인됨",
    "resumeFailedMsg": "재개 요청 실패",
    "resumeFailStatus": "실패 {status}",
    "batchQueuedMsg": "{n}화 일괄 생성 대기열에 추가됨 (지속 큐, 한 화씩 처리 중…)",
    "batchStartedMsg": "{n}화 일괄 생성 시작됨 (동시 처리 {concurrency}, 진행 중…)",
    "noPendingEpisodes": "생성 대기 중인 에피소드가 없습니다",
    "healthGateIssuePrefix": "문제 에피소드: ",
    "healthGateEpisodeDetail": "{ep}화 ({shots}컷 다운그레이드됨)",
    "healthGateConfirmHint": "그래도 내보내시겠습니까? (권장: 다운그레이드된 컷 먼저 수정)",
    dramaPackageBtn: "📦 해외 패키지",
    dramaPackageFetching: "패키지 데이터 가져오는 중…",
    dramaPackageTitle: "해외 패키지 · TikTok Drama Center",
    dramaPackageDownload: "JSON 다운로드",
    dramaPackageCoverAlt: "시리즈 커버",
    dramaPackageLangEpisodes: "언어: {lang} · 총 {n}화",
    dramaPackageTotalMin: "총 길이: {n}분",
    dramaPackageEpFree: "무료",
    dramaPackageEpCoins: "{coins} coins",
    dramaPackageGuideTitle: "업로드 단계",
    dramaPackageErrPrefix: "가져오기 실패: ",
    dramaPackageNetworkErr: "네트워크 오류",
    dramaPackageViewVideo: "영상 보기",
    dramaPackageAiDeclaration: "본 작품이 AI 생성 / 딥합성 기술로 제작되었음을 확인합니다(패키지에 선언 포함)",
    dramaPackageAiRequiredHint: "먼저 AI 선언에 체크하세요",
  },
  "providerHealth": {
    "ok": "정상",
    "planLimited": "요금제 제한",
    "outOfCredits": "크레딧 소진",
    "authError": "인증 실패",
    "misconfigured": "설정 오류",
    "down": "연결 불가",
    "notConfigured": "미설정",
    "recharge": "충전하기",
    "checkKey": "Key 확인",
    "addConfig": "설정 추가",
    "checkNetwork": "네트워크/서비스 확인",
    "optionalSetup": "선택 사항",
    "upgradePlan": "결제 방식 변경"
  }
};
const ru: Translations = {
  "collab": {
    "notifTitle": "Уведомления",
    "markAllRead": "Отметить все прочитанными",
    "justNow": "только что",
    "mentioned": "упомянул вас",
    "replied": "ответил вам",
    "notifEmpty": "Нет уведомлений",
    "loginPrompt": "Войдите, чтобы видеть уведомления",
    "reply": "Ответить",
    "deleted": "[удалено]",
    "commentPlaceholder": "Написать комментарий… @ для упоминания",
    "commentEmpty": "Комментариев пока нет — будьте первым",
    "send": "Отправить",
    "confirmDelete": "Удалить этот комментарий?",
    "demoMode": "Демо-режим",
    "demoEnginesOff": "движок(и) не настроен(ы)",
    "demoPlaceholder": "в генерации будут использоваться placeholder-ресурсы",
    "demoLipsyncReady": "синхронизация губ работает из коробки",
    "demoHowToEnable": "Как активировать",
    "demoImage": "изображение",
    "demoVideo": "видео",
    "readinessTitle": "Настройка движка",
    "readinessReal": "реальный",
    "readinessSim": "заглушка"
  },
  "common": {
    "create": "Создать",
    "save": "Сохранить",
    "cancel": "Отмена",
    "delete": "Удалить",
    "edit": "Редактировать",
    "share": "Поделиться",
    "download": "Скачать",
    "loading": "Загрузка...",
    "error": "Ошибка",
    "success": "Успешно",
    "viewAll": "Смотреть все",
    "backHome": "На главную",
    "saveChanges": "Сохранить изменения",
    "saving": "Сохранение...",
    "reset": "Сбросить"
  },
  "brand": {
    "studio": "AI Comic Studio"
  },
  "nav": {
    "home": "Главная",
    "projects": "Мои проекты",
    "create": "Создать",
    "pricing": "Тарифы",
    "profile": "Профиль",
    "settings": "Настройки",
    "polish": "Шлифовка сценария",
    "workbench": "Рабочий стол",
    "cases": "Витрина",
    "userCenter": "Панель управления",
    "newProject": "Новый проект"
  },
  "create": {
    "badge": "AI-студия создания",
    "title": "Начните свой творческий путь",
    "subtitle": "Опишите идею — AI-команда создаст для вас полноценный комикс-сериал",
    "ideaLabel": "Идея истории",
    "ideaPlaceholder": "Например: история любви путешественника во времени...",
    "videoProviderLabel": "Движок генерации видео",
    "startButton": "Начать создание"
  },
  "projects": {
    "title": "Мои проекты",
    "subtitle": "Управляйте всеми своими AI-комикс проектами",
    "searchPlaceholder": "Поиск по названию или описанию...",
    "filterAll": "Все",
    "filterCompleted": "Завершённые",
    "filterCreating": "В процессе",
    "filterFailed": "Ошибка",
    "noResults": "Проекты не найдены",
    "createNew": "Создать новый проект",
    "shotsUnit": "кадров"
  },
  "dashboard": {
    "systemOnline": "Система в сети",
    "title": "Обзор создания",
    "subtitle": "Мультиагентный AI-движок — конвейер от идеи до готового фильма",
    "quickStartTitle": "Начать создание",
    "quickStartSubtitle": "Введите идею — команда из 7 AI-агентов создаст её за вас",
    "statProjects": "Мои проекты",
    "statProjectsSub": "Комикс-проекты в работе",
    "statGenerations": "Генераций",
    "statGenerationsSub": "Всего вызовов AI",
    "statCases": "Витрина",
    "statCasesSub": "Референсные шаблоны",
    "recentCreations": "Недавние работы",
    "noRecords": "Пока нет ни одной работы",
    "startFirst": "Создайте первую →",
    "systemStatus": "Состояние системы",
    "recentActivity": "Последние действия",
    "statusCompleted": "Завершено",
    "statusCreating": "Создаётся",
    "statusDraft": "Черновик"
  },
  "settings": {
    "title": "Настройки",
    "subtitle": "Управляйте предпочтениями приложения и параметрами аккаунта",
    "general": "Основные",
    "generalDesc": "Язык и региональные настройки",
    "language": "Язык",
    "appearance": "Внешний вид",
    "appearanceDesc": "Настройте тему интерфейса",
    "theme": "Тема",
    "themeDark": "Тёмная",
    "themeLight": "Светлая",
    "themeAuto": "Системная",
    "notifications": "Уведомления",
    "notificationsDesc": "Управление уведомлениями",
    "projectDone": "Уведомление о завершении проекта",
    "projectDoneDesc": "Получать уведомление, когда проект готов",
    "performance": "Производительность",
    "performanceDesc": "Оптимизировать производительность приложения",
    "videoQuality": "Качество видео",
    "qualityHigh": "Высокое",
    "qualityMedium": "Среднее",
    "qualityLow": "Низкое (экономия трафика)",
    "privacy": "Конфиденциальность и безопасность",
    "privacyDesc": "Защита вашего аккаунта",
    "changePassword": "Изменить пароль",
    "enable2fa": "Включить 2FA",
    "manageDevices": "Управление устройствами",
    "billing": "Оплата и подписка",
    "billingDesc": "Управление подпиской",
    "freePlan": "Бесплатный план",
    "currentPlan": "Текущий план",
    "freeQuota": "10 проектов в месяц",
    "upgradePro": "Перейти на Pro",
    "saved": "Настройки сохранены",
    "savedDesc": "Ваши предпочтения обновлены",
    "resetDone": "Настройки сброшены"
  },
  "profile": {
    "title": "Профиль",
    "subtitle": "Управляйте личными данными и предпочтениями",
    "avatar": "Аватар",
    "uploadAvatar": "Загрузить аватар",
    "basicInfo": "Основная информация",
    "basicInfoDesc": "Обновите профиль",
    "username": "Имя пользователя",
    "email": "Email",
    "bio": "О себе",
    "bioPlaceholder": "Расскажите о себе...",
    "stats": "Статистика",
    "totalProjects": "Всего проектов",
    "inProgress": "В процессе",
    "totalShots": "Всего кадров",
    "saveSuccess": "Сохранено",
    "saveSuccessDesc": "Профиль обновлён",
    "role": "Роль",
    "accountPrefs": "Аккаунт и настройки",
    "visualPref": "Визуальные предпочтения",
    "collabSpace": "Пространство совместной работы"
  },
  "billing": {
    "title": "Подписка",
    "currentTier": "Текущий план: ",
    "paymentNote": "Оплата через Stripe Checkout; отмена или смена карты — через Stripe Customer Portal",
    "recommended": "Рекомендовано",
    "currentBadge": "Текущий",
    "contactUs": "Связаться с нами",
    "perMonth": "/мес",
    "alreadyThis": "Текущий план",
    "freeNoPurchase": "Бесплатно · без покупки",
    "businessTalk": "Связаться с продажами",
    "upgradeTo": "Перейти на",
    "portalNote": "Повышение, понижение, отмена и смена оплаты — в Stripe Customer Portal; для self-hosting требуется STRIPE_PORTAL_LINK.",
    "openPortal": "Открыть Stripe Customer Portal",
    "checkoutFailed": "Ошибка оформления",
    "paymentCanceled": "Оплата отменена",
    "upgradedPrefix": "Переход на",
    "upgradedSuffix": "! Подписка активна"
  },
  "cases": {
    "title": "Витрина",
    "titlePublic": "Избранные работы",
    "subtitle": "От партнёров и авторов QingFeng",
    "subtitleReuse": "От партнёров и авторов QingFeng · нажмите, чтобы использовать идею",
    "copyPrompt": "Скопировать промпт",
    "copied": "Скопировано",
    "usePrompt": "Использовать"
  },
  "home": {
    "heroTagline1": "/ Консоль производства AI-сериалов — не просто генерация",
    "heroTagline2": "Аудит темпа · контроль качества · консистентность персонажей · AAF/EDL в монтаж · командная работа — от «генерирует» до «сдаёт».",
    "heroEngines": "Слой генерации · подключи лучшие движки (BYO key)",
    "heroCtaCreate": "Начать создание →",
    "heroCtaCases": "Смотреть работы",
    "featureTitle": "Управляй темпом как режиссёр",
    "featureSubtitle": "Визуальный совместный воркфлоу: сценарий, раскадровка, анимация и звук.",
    "agentsTitle": "Команда AI-агентов анимации",
    "agentsSubtitle": "Каждая роль сотрудничает в реальном времени.",
    "lensCaption": "Блок линз: настройка движения камеры, фокусного расстояния и угла",
    "lensTitle": "Кинематографический язык, единый для каждого кадра",
    "lensDesc": "Единый стиль, цвет и правила движения камеры.",
    "frameTitle": "Раскадровки быстро создаются AI",
    "frameSubtitle": "Из одного предложения — редактируемая мультикадровая последовательность.",
    "frameSteps": [{
        "title": "Структура сценария",
        "desc": "Умный разбор темпа истории"
      }, {
        "title": "Разбивка на кадры",
        "desc": "Автоматическая мультикадровая раскадровка"
      }, {
        "title": "Настройка персонажей",
        "desc": "Консистентность персонажей и стиля"
      }],
    "frameCta": "Создать раскадровку",
    "vibeKicker": "Мудборд: живые обновления визуала и звука",
    "vibeTitle": "Настроение и ритм в реальном времени",
    "vibeDesc": "Визуал, камера и музыка вместе передают эмоцию.",
    "casesTitle": "Избранные работы",
    "casesSubtitle": "От партнёров и авторов QingFeng.",
    "casesTryNow": "Попробовать",
    "ctaTitle": "Превратите историю в анимацию",
    "ctaDesc": "Создайте свой первый AI-комикс прямо сейчас",
    "ctaButton": "Перейти в рабочий стол"
  },
  "pricing": {
    "enterWorkbench": "Перейти в рабочий стол",
    "badge": "Тарифы",
    "titleLead": "Выберите ",
    "titleHighlight": "подходящий план",
    "subtitle": "От бесплатного доступа до корпоративного self-hosting — QingFeng предлагает каждому автору оптимальный план.",
    "custom": "Индивидуальный",
    "customNote": "Цена по запросу, свяжитесь с продажами",
    "free": "Бесплатно",
    "startUsing": "Начать",
    "apiAccess": "Доступ к API",
    "commercialLicense": "Коммерческая лицензия",
    "footnote": "Все планы включают поддержку AI-движка 24/7 · вступает в силу сразу после оплаты · отмена в любое время",
    "faqTitle": "Часто задаваемые вопросы",
    "faq": [{
        "q": "Каковы ограничения бесплатного плана?",
        "a": "Бесплатный план позволяет 3 проекта в месяц, до 5 персонажей в библиотеке, экспорт видео в 720p и включает водяной знак QingFeng. Подходит для личного ознакомления."
      }, {
        "q": "Могу ли я использовать новые функции сразу после перехода на платный план?",
        "a": "Да. После успешной оплаты преимущества соответствующего плана активируются немедленно — проверка не требуется."
      }, {
        "q": "Можно ли использовать сгенерированный контент в коммерческих целях?",
        "a": "Авторские права на сгенерированные материалы принадлежат базовым движкам (Kling, MiniMax и др.). Возможность коммерческого использования зависит от условий каждого движка — проверяйте их самостоятельно. QingFeng предоставляет только инструменты оркестрации и постобработки и не гарантирует коммерческих прав на контент."
      }, {
        "q": "Чем Enterprise отличается от Pro?",
        "a": "Enterprise поддерживает self-hosting — развёртывание полной AI-системы на ваших серверах — плюс разработку кастомных AI-агентов, гарантии SLA и выделенного менеджера по работе с клиентами."
      }, {
        "q": "Могу ли я отменить подписку в любое время?",
        "a": "Да. Отменить подписку можно в настройках аккаунта в любое время. После отмены доступ сохраняется до конца текущего расчётного периода."
      }],
    "moreTitle": "Остались вопросы?",
    "moreDesc": "Наша команда всегда готова помочь",
    "contactSupport": "Связаться с поддержкой",
    "alertPayment": "Оплата ещё не подключена — сейчас это бесплатная / самостоятельно размещаемая версия."
  },
  "help": {
    "examples": "Примеры",
    "title": "Справочный центр",
    "subtitle": "Найдите ответы на свои вопросы и начните создавать AI-комиксы",
    "searchPlaceholder": "Поиск по справке...",
    "quickGuides": "Быстрые руководства",
    "guides": [{
        "title": "Быстрый старт",
        "description": "Создайте первый AI-комикс за 5 минут"
      }, {
        "title": "Руководство по созданию",
        "description": "Техники и лучшие практики AI-создания комиксов"
      }, {
        "title": "Уроки сообщества",
        "description": "Советы от сообщества авторов"
      }],
    "faqTitle": "Часто задаваемые вопросы",
    "faqs": [{
        "q": "Как начать первый проект?",
        "a": "Нажмите «Начать создание», введите идею истории, выберите видеодвижок — AI создаст для вас полный комикс-сериал."
      }, {
        "q": "Какие видеодвижки поддерживаются?",
        "a": "Поддерживаются Minimax, Vidu, Kling AI и другие — выберите тот, что подходит именно вам."
      }, {
        "q": "Сколько времени занимает генерация проекта?",
        "a": "Обычно 5–15 минут, в зависимости от сложности проекта и выбранного движка."
      }, {
        "q": "Можно ли редактировать AI-контент?",
        "a": "Да — вы можете редактировать сценарий, дизайн персонажей и раскадровку, сохраняя полный контроль."
      }, {
        "q": "Можно ли использовать работы в коммерческих целях?",
        "a": "Авторские права на контент принадлежат генерирующим движкам. Проверяйте условия каждого движка для коммерческого использования; QingFeng предоставляет только инструменты редактирования и постобработки."
      }, {
        "q": "Как экспортировать работу?",
        "a": "На странице проекта нажмите «Скачать» — будут экспортированы видео, изображения, сценарий и все ресурсы."
      }],
    "moreTitle": "Остались вопросы?",
    "moreDesc": "Наша команда поддержки всегда готова помочь",
    "sendEmail": "Написать email",
    "liveChat": "Онлайн-чат"
  },
  "examples": {
    "title": "Избранные работы",
    "subtitle": "Исследуйте потрясающие комикс-сериалы, созданные AI",
    "ctaTitle": "Готовы создать своё?",
    "ctaDesc": "Присоединитесь к тысячам авторов и начните свой AI-комикс путь",
    "ctaButton": "Создать сейчас"
  },
  "visionAudit": {
    "verdictExcellent": "Отлично",
    "verdictGood": "Хорошо",
    "verdictNeedsWork": "Требует доработки",
    "verdictPoor": "Неудовлетворительно",
    "noDataMessage": "Данных проверки качества пока нет. После генерации финального видео каждый кадр будет оценён AI на соответствие сценарию.",
    "panelTitle": "Контроль качества · Видео vs Сценарий",
    "avgScore": "Средний балл",
    "shotUnit": "Кадр",
    "passLabel": "Принято",
    "warnLabel": "Предупреждение",
    "failLabel": "Не по сценарию",
    "weakestShotsTitle": "Приоритетные кадры (требуют внимания):",
    "rebirthPlanPrefix": "План переснятия · ",
    "rebirthPlanSuffix": " слабых кадров рекомендовано переснять",
    "reshootButton": "В мастерскую для переснятия",
    "dimScene": "Сцена",
    "dimAction": "Действие",
    "dimMood": "Настроение",
    "dimComposition": "Композиция"
  },
  "usagePage": {
    "eyebrow": "Использование и стоимость",
    "headline": "Наблюдаемость затрат",
    "budgetLabel": "Месячный бюджет ¥",
    "budgetPlaceholder": "Без ограничений",
    "nearDays": "За",
    "daySuffix": "дн.",
    "daysCostSuffix": "затраты за период",
    "refreshTitle": "Обновить",
    "loading": "Загрузка…",
    "loadFailed": "Ошибка загрузки",
    "activeAlertsBanner": "Активные квотные предупреждения · за последний час",
    "goBilling": "К оплате",
    "statusOk": "Бюджет в норме",
    "statusWarn": "Близко к лимиту",
    "statusOver": "Бюджет превышен",
    "statusNone": "Лимит не задан",
    "alertExhausted": "Квота исчерпана",
    "alertSaturated": "Апстрим насыщен",
    "alertRateLimited": "Превышен rate limit",
    "alertAuthFailed": "Ошибка авторизации",
    "alertModelUnavailable": "Модель недоступна",
    "thisMonthBudget": "Бюджет на месяц",
    "quotaTitle": "Месячная квота",
    "quotaUnlimited": "Без лимита",
    "quotaExceeded": "Превышен лимит плана — пополните или смените движок",
    "quotaNearLimit": "Близко к лимиту плана",
    "quotaOfCeiling": "лимит плана",
    "projectedEndPrefix": "Прогноз на конец месяца",
    "noCapSuffix": " · Лимит не задан",
    "statGenerations": "Генераций",
    "statEngines": "Движков",
    "engineCostPrefix": "Расходы по движкам · за",
    "engineNoData": "Записей о затратах за этот период нет.",
    "dailyTrendTitle": "Ежедневная динамика затрат",
    "dailyNoData": "Ежедневных данных нет.",
    "countSuffix": "вызовов"
  },
  "healthPage": {
    "title": "Здоровье API",
    "subtitle": "Статус моделей / шлюзов в реальном времени · квотные проблемы и сбои — с первого взгляда",
    "refreshBtn": "Повторная проверка",
    "loadFailed": "Проверка не удалась",
    "kindLlm": "LLM",
    "kindTts": "TTS",
    "kindVideo": "Видео",
    "kindImage": "Изображение",
    "kindGateway": "Шлюз",
    "overallHealthy": "Всё в норме",
    "overallWarning": "Предупреждения",
    "overallCritical": "Сбой / Задолженность",
    "balanceUsed": "Использовано",
    "balanceAbundant": "Квота в достатке (предоплата)",
    "balanceRemaining": "Остаток",
    "balanceLimit": "Лимит",
    "radarTitle": "Радар моделей",
    "radarDesc": "Сканирует каждый API на наличие новых моделей · обновление только в рамках одного семейства · живой тест на 1 токен для LLM · откат сохранён · без перезапуска",
    "scanBtn": "Сканировать новые модели",
    "upgradeBtn": "Обновить до последних",
    "statusUpgradable": "Доступно обновление",
    "statusUpToDate": "Актуальна",
    "statusFamilyN": "· {n} в семействе",
    "statusSourceUnavail": "Источник недоступен",
    "overridesTitle": "Активные переопределения (откат доступен):",
    "rollbackBtn": "Откат",
    "rollbackDefault": "(восстановить код по умолчанию)",
    "checkedAt": "Проверено в",
    "cachedNote": "· Кэшированный результат (нажмите «Повторная проверка» для обновления)",
    "footer": "· Панель управления читает только квоты; API-ключи не хранятся и не передаются.",
    "scanFailed": "Сканирование не удалось",
    "upgradeFailed": "Обновление не удалось",
    "upgradeFailedLogin": "Обновление не удалось (требуется вход)",
    "upgradeNone": "Нет доступных обновлений",
    "upgradedSummary": "Обновлено {n} элемент(ов): {list}{skipped} — применено без перезапуска",
    "upgradeSkippedNote": " ({n} пропущено: живой тест не прошёл, сохранено исходное значение)",
    "upgradeSomeSkipped": "{n} кандидат(ов) не прошли живой тест, текущая конфигурация сохранена",
    "rolledBack": "{envKey} откатан"
  },
  "seriesDetail": {
    "statusDraft": "Ожидает",
    "statusActive": "Генерируется",
    "statusCompleted": "Завершено",
    "statusFailed": "Ошибка · Повторить",
    "backLink": "Назад",
    "pageTitle": "Сериал · Пакетная генерация",
    "statTotal": "Всего {n} серий",
    "statCompleted": "Завершено {n}",
    "statGenerating": "Генерируется {n}",
    "statFailed": "Ошибка {n}",
    "statPending": "Ожидает {n}",
    "batchGenerateBtn": "Пакетная генерация",
    "batchGeneratePendingHint": "({n} ожидает)",
    "regenerateAll": "Регенерировать все",
    "seasonAssetsTitle": "Ресурсы сезона",
    "seasonCoverAlt": "Обложка сезона",
    "genCoverBtn": "Создать обложку",
    "regenCoverBtn": "Пересоздать обложку",
    "exportSeasonBtn": "Экспортировать весь сезон",
    "reexportSeasonBtn": "Повторный экспорт сезона",
    "exportFirstEpisodeHint": "Сначала создайте хотя бы одну серию",
    "watchSeasonVideo": "Смотреть весь сезон",
    "seasonVideoDesc": "Компиляция = завершённые серии, склеенные по порядку (нормализованное соотношение сторон + перекодирование).",
    "seasonFixBusyLabel": "⏳ Исправление сезона…",
    "seasonFixLabel": "⚡ Исправить пониженные кадры ({n} серий затронуто)",
    "seasonFixProgressMsg": "Исправление серии {episode} ({current}/{total})…",
    "seasonFixDoneMsg": "Исправление сезона завершено ({n} серий), повторная проверка…",
    "resumeStuckBtn": "🛟 Возобновить зависшие серии (нет прогресса 30 мин → сбросить в ожидание)",
    "loading": "Загрузка…",
    "noEpisodes": "В этом сериале нет серий",
    "episodeLabel": "Эп.{n}",
    "healthCheckAllGreen": "Все проверки пройдены",
    "shotsDowngradedLabel": "{n} кадров понижено",
    "openEpisodeLink": "Открыть →",
    "loadFailStatus": "Ошибка загрузки {status}, обновите страницу",
    "loadFailNetwork": "Ошибка загрузки, проверьте соединение и обновите страницу",
    "requestFailed": "Запрос не выполнен",
    "exportingSeasonMsg": "Экспорт полного сезона (скачивание серий + склейка и перекодирование, до ~5 мин, не закрывайте страницу)…",
    "exportCanceledMsg": "Экспорт отменён — сначала исправьте пониженные кадры, затем повторите экспорт",
    "exportFailedStatus": "Ошибка экспорта {status}",
    "exportDoneMsg": "Полный сезон экспортирован ({n} серий)",
    "coverGeneratingMsg": "Создание обложки сезона…",
    "coverFailedStatus": "Ошибка создания обложки {status}",
    "coverDoneMsg": "Обложка сезона создана",
    "resumeCheckedMsg": "Проверено",
    "resumeFailedMsg": "Запрос возобновления не выполнен",
    "resumeFailStatus": "Ошибка {status}",
    "batchQueuedMsg": "Добавлено {n} серий в очередь пакетной генерации (постоянная очередь, обрабатывается по одной…)",
    "batchStartedMsg": "Запущена пакетная генерация {n} серий (параллельность {concurrency}, обрабатывается…)",
    "noPendingEpisodes": "Нет серий, ожидающих генерации",
    "healthGateIssuePrefix": "Проблемные серии: ",
    "healthGateEpisodeDetail": "Эп.{ep} ({shots} кадров понижено)",
    "healthGateConfirmHint": "Всё равно экспортировать? (Рекомендуется: сначала исправить пониженные кадры)",
    dramaPackageBtn: "📦 Экспорт-пакет",
    dramaPackageFetching: "Получение пакета…",
    dramaPackageTitle: "Экспорт-пакет · TikTok Drama Center",
    dramaPackageDownload: "Скачать JSON",
    dramaPackageCoverAlt: "Обложка сериала",
    dramaPackageLangEpisodes: "Язык: {lang} · {n} серий",
    dramaPackageTotalMin: "Всего: {n} мин",
    dramaPackageEpFree: "Бесплатно",
    dramaPackageEpCoins: "{coins} coins",
    dramaPackageGuideTitle: "Шаги загрузки",
    dramaPackageErrPrefix: "Ошибка получения: ",
    dramaPackageNetworkErr: "Ошибка сети",
    dramaPackageViewVideo: "Смотреть видео",
    dramaPackageAiDeclaration: "Я подтверждаю, что этот фильм создан ИИ / синтетическими медиа; декларация войдёт в пакет",
    dramaPackageAiRequiredHint: "Сначала подтвердите декларацию об ИИ",
  },
  "providerHealth": {
    "ok": "В норме",
    "planLimited": "Ограничено тарифом",
    "outOfCredits": "Квота исчерпана",
    "authError": "Ошибка авторизации",
    "misconfigured": "Неверная конфигурация",
    "down": "Недоступен",
    "notConfigured": "Не настроен",
    "recharge": "Пополнить",
    "checkKey": "Проверить ключ",
    "addConfig": "Добавить конфигурацию",
    "checkNetwork": "Проверить сеть/сервис",
    "optionalSetup": "Необязательно",
    "upgradePlan": "Сменить тариф"
  }
};

const translations: Record<Locale, Translations> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en': en,
  'ja': ja,
  // v12.213:ko/ru 全量文案包已成
  'ko': ko,
  'ru': ru,
};

/** 支持的全部 locale (有序: 简/繁/英/日). */
export const LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'ru'];

/** 语言切换器显示名 (各用自身语言写). */
export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'ru': 'Русский',
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
  if (s.startsWith('ko')) return 'ko';
  if (s.startsWith('ru')) return 'ru';
  if (s.startsWith('en')) return 'en';
  // v12.186:未知语言标签回退 en(此前回 zh-CN —— 俄语等非中文用户看全中文 UI);
  // 空输入仍回 zh-CN(无信号维持主用户群默认)。
  return 'en';
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
    if (s.startsWith('zh') || s.startsWith('en') || s.startsWith('ja') || s.startsWith('ko') || s.startsWith('ru')) return loc;
  }
  // v12.186:头里全是我们不支持的语言 → 该用户显然非中文用户,回退 en(原 zh-CN)
  return 'en';
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
  // v12.186:ko/ru 文案包未成 —— 以 en 字典兜底(键级渐进补真文案零结构改动)
  const effective = (locale === 'ko' || locale === 'ru') ? 'en' : locale;
  const t = translations[effective as keyof typeof translations];
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
