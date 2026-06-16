/**
 * lib/publish-adapters (v12.3.3) — 适配器选择器(阶段二十二)。
 *
 * youtube_shorts → YouTube Data API 参考适配器(BYO 真上传)。
 * 其余国内平台 → manual 诚实降级适配器(导出包 + 手动上传指引)。
 */
import { PLATFORM_SPECS } from '../distribution';
import type { PublishAdapter } from './types';
import { createManualAdapter } from './manual';
import { createYouTubeAdapter, type YouTubeDeps } from './youtube';

export type { PublishAdapter, UploadResult, UploadOptions, AdapterMode } from './types';
export { createManualAdapter } from './manual';
export { createYouTubeAdapter } from './youtube';

const LABEL_BY_ID = new Map<string, string>(PLATFORM_SPECS.map((s) => [s.id, s.label]));

/** 取某平台的发布适配器。deps 仅 youtube 用(测试注入网络/token)。 */
export function getPublishAdapter(platform: string, deps?: YouTubeDeps): PublishAdapter {
  if (platform === 'youtube_shorts') return createYouTubeAdapter(deps);
  const label = LABEL_BY_ID.get(platform) || platform;
  return createManualAdapter(platform, label);
}

/** 给前端的适配器能力概览(UI 如实标注「真上传 / 手动上传」)。 */
export interface AdapterInfo {
  platform: string;
  label: string;
  mode: 'api' | 'manual';
  configured: boolean;
}

export function listAdapterInfo(deps?: YouTubeDeps): AdapterInfo[] {
  return PLATFORM_SPECS.map((s) => {
    const a = getPublishAdapter(s.id, deps);
    return { platform: s.id, label: s.label, mode: a.mode, configured: a.isConfigured() };
  });
}
