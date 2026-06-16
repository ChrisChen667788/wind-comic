/**
 * lib/publish-adapters/manual (v12.3.3) — 诚实降级适配器(阶段二十二)。
 *
 * 国内平台(抖音/快手/视频号/小红书/B站)多无公开「发布」API,且 OAuth 我不代填(安全规则)。
 * → 这些平台用 manual 适配器:isConfigured 恒 false,upload 返回「可直发包 + 手动上传指引」,
 *    status='manual',**绝不假称 published**。UI 如实标注「该平台无公开发布 API / 需手动上传」。
 */
import type { PublishAdapter, UploadResult } from './types';
import type { PublishPackage } from '../publish-package';

/** 各平台的手动上传指引(创作者后台/App 入口)。 */
const MANUAL_STEPS: Record<string, string[]> = {
  douyin: ['打开抖音 App 或「抖音创作服务平台」(creator.douyin.com)', '上传成片 → 粘贴标题/话题/简介(已在包内一键复制)', '设置封面为包内封面 → 选定时/立即发布'],
  kuaishou: ['打开快手 App 或「快手创作者平台」(cp.kuaishou.com)', '上传成片 → 粘贴文案 → 设封面 → 发布'],
  shipinhao: ['微信 →「视频号助手」(channels.weixin.qq.com)', '上传成片 → 填标题/话题 → 设封面 → 发表'],
  xiaohongshu: ['小红书 App 或「创作服务平台」(creator.xiaohongshu.com)', '发布视频笔记 → 标题≤20字 + 多标签(包内已备)→ 设封面 → 发布'],
  bilibili: ['B站「创作中心」(member.bilibili.com)', '投稿 → 上传成片 → 填标题/分区/标签 → 设封面 → 投稿'],
  tiktok: ['TikTok App 或 tiktok.com 网页上传', 'Upload → 粘贴英文标题/话题(包内已备)→ 设封面 → Post', '注:TikTok 有 Content Posting API,但需 OAuth 授权,我不代填 → 暂走手动'],
};

const DEFAULT_STEPS = ['下载包内成片 + 封面', '到该平台创作者后台上传 → 粘贴包内标题/话题/简介', '发布'];

/** 国内平台诚实降级适配器工厂。 */
export function createManualAdapter(platform: string, label: string): PublishAdapter {
  return {
    platform,
    label,
    mode: 'manual',
    isConfigured: () => false,
    async upload(_pkg: PublishPackage): Promise<UploadResult> {
      return {
        status: 'manual',
        externalUrl: null,
        externalId: null,
        message: `${label} 无公开发布 API —— 已生成可直发包(成片/封面/文案),请手动上传`,
        instructions: MANUAL_STEPS[platform] ?? DEFAULT_STEPS,
      };
    },
    async status() {
      return null; // 手动上传无平台侧状态可查
    },
  };
}
