export interface PricingTier {
  id: string;
  name: string;
  nameEn: string;
  price: number;        // Monthly price in CNY, 0 for free
  priceUnit: string;    // '元/月'
  features: string[];
  limits: {
    projectsPerMonth: number;   // -1 means unlimited
    characterLibrary: number;   // -1 means unlimited
    videoResolution: string;
    watermark: boolean;
    apiAccess: boolean;
    priorityQueue: boolean;
    commercialLicense: boolean;
  };
  recommended?: boolean;
  color: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'free',
    name: '免费版',
    nameEn: 'Free',
    price: 0,
    priceUnit: '元/月',
    color: '#6B7280',
    features: [
      '每月 3 个项目',
      '5 个角色库名额',
      '720p 视频导出',
      '含青枫水印',
      '基础 AI 生成',
      '社区支持',
    ],
    limits: {
      projectsPerMonth: 3,
      characterLibrary: 5,
      videoResolution: '720p',
      watermark: true,
      apiAccess: false,
      priorityQueue: false,
      commercialLicense: false,
    },
  },
  {
    id: 'creator',
    name: '创作版',
    nameEn: 'Creator',
    price: 98,
    priceUnit: '元/月',
    color: '#4A7EBB',
    features: [
      '无限项目数量',
      '50 个角色库名额',
      '1080p 视频导出',
      '无水印',
      '高质量 AI 生成',
      '邮件支持',
    ],
    limits: {
      projectsPerMonth: -1,
      characterLibrary: 50,
      videoResolution: '1080p',
      watermark: false,
      apiAccess: false,
      priorityQueue: false,
      commercialLicense: false,
    },
  },
  {
    id: 'pro',
    name: '专业版',
    nameEn: 'Pro',
    price: 298,
    priceUnit: '元/月',
    color: '#E8C547',
    recommended: true,
    features: [
      '无限项目数量',
      '无限角色库',
      '4K 视频导出',
      '无水印',
      'API 访问权限',
      '优先队列处理',
      '商业授权',
      '专属客服支持',
    ],
    limits: {
      projectsPerMonth: -1,
      characterLibrary: -1,
      videoResolution: '4K',
      watermark: false,
      apiAccess: true,
      priorityQueue: true,
      commercialLicense: true,
    },
  },
  {
    id: 'enterprise',
    name: '企业版',
    nameEn: 'Enterprise',
    price: -1,    // -1 means custom / contact us
    priceUnit: '定制',
    color: '#A78BFA',
    features: [
      '私有化部署',
      '自定义 AI 智能体',
      '专属服务器资源',
      '无限一切',
      'SLA 保障',
      '专属客户成功经理',
      '定制化开发支持',
      '企业商业授权',
    ],
    limits: {
      projectsPerMonth: -1,
      characterLibrary: -1,
      videoResolution: '4K+',
      watermark: false,
      apiAccess: true,
      priorityQueue: true,
      commercialLicense: true,
    },
  },
];

export function getTierById(id: string): PricingTier | undefined {
  return PRICING_TIERS.find((t) => t.id === id);
}

export function getTierLabel(id: string): string {
  return getTierById(id)?.name ?? '免费版';
}
