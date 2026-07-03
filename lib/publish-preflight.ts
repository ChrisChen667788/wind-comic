/**
 * 发布预检(v12.73.0)——成片投平台前的硬指标核对。
 *
 * 病根:成片发到抖音/小红书/视频号被拒或被压质,原因往往是可预检的硬指标
 * (画幅不对/太短太长/没音轨/文件过大)。本模块纯函数逐平台核对,给「能不能发 + 为什么」。
 */

export interface VideoMeta {
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface PlatformSpec {
  id: 'douyin' | 'xiaohongshu' | 'shipinhao';
  label: string;
  preferredAspect: 'vertical' | 'any';
  minSec: number;
  maxSec: number;
  maxBytes: number;
}

export const PLATFORM_SPECS: PlatformSpec[] = [
  { id: 'douyin', label: '抖音', preferredAspect: 'vertical', minSec: 5, maxSec: 15 * 60, maxBytes: 4 * 1024 ** 3 },
  { id: 'xiaohongshu', label: '小红书', preferredAspect: 'vertical', minSec: 5, maxSec: 15 * 60, maxBytes: 2 * 1024 ** 3 },
  { id: 'shipinhao', label: '视频号', preferredAspect: 'any', minSec: 3, maxSec: 60 * 60, maxBytes: 4 * 1024 ** 3 },
];

export interface PreflightResult {
  platform: string;
  label: string;
  pass: boolean;
  issues: string[];   // 阻断项
  warnings: string[]; // 建议项(不阻断)
}

export function evaluateForPlatform(meta: VideoMeta, spec: PlatformSpec): PreflightResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  if (meta.durationSec < spec.minSec) issues.push(`时长 ${meta.durationSec.toFixed(1)}s < 平台下限 ${spec.minSec}s`);
  if (meta.durationSec > spec.maxSec) issues.push(`时长超平台上限 ${Math.round(spec.maxSec / 60)}min`);
  if (meta.sizeBytes > spec.maxBytes) issues.push(`文件 ${(meta.sizeBytes / 1024 ** 3).toFixed(2)}GB 超上限`);
  if (!meta.hasAudio) issues.push('无音轨(平台大概率判残片)');
  const vertical = meta.height > meta.width;
  if (spec.preferredAspect === 'vertical' && !vertical) warnings.push('横屏成片在竖屏信息流会被加黑边/降权,建议 9:16');
  if (Math.min(meta.width, meta.height) < 540) warnings.push(`分辨率 ${meta.width}x${meta.height} 偏低,建议短边 ≥720`);
  return { platform: spec.id, label: spec.label, pass: issues.length === 0, issues, warnings };
}

export function preflightAll(meta: VideoMeta): PreflightResult[] {
  return PLATFORM_SPECS.map((s) => evaluateForPlatform(meta, s));
}
