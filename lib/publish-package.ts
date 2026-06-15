/**
 * lib/publish-package (v12.3.0) — 一键成片打包(阶段二十二 · 分发/发布闭环)。
 *
 * 把已经各自建好的散件 —— 分发文案(distribution PlatformPack)+ 成片 + 封面 —— 组装成
 * 一个「可直发包」:平台规格 + 标题/标签/话题/简介 + 视频 + 封面 + 一键复制文案 + 缺件告警。
 * 纯函数、零 IO、可单测。路由负责取 DB 资产喂进来。
 */
import type { PlatformSpec, PlatformPack } from './distribution';

export interface PublishPackage {
  platform: string;
  label: string;
  spec: { aspect: string; titleMaxLen: number; tagCount: number; descMaxLen: number };
  title: string;
  titleAlternatives: string[];
  tags: string[];
  hashtags: string;           // '#tag1 #tag2 ...'
  description: string;
  tips: string;
  video: { url: string | null; recommendedAspect: string; platformReady: boolean };
  cover: { url: string | null };
  copyText: string;           // 标题 + 话题 + 简介,一键复制
  ready: boolean;             // 标题 + 视频 + 封面 齐 → 可直发
  warnings: string[];         // 缺件 / 超限提示
}

export interface PublishMedia {
  /** 项目原成片 URL(回退源) */
  finalVideoUrl?: string | null;
  /** 已按平台 aspect 导好的成片 URL(有则优先,platformReady=true) */
  platformVideoUrl?: string | null;
  /** 封面 URL(定版封面 或封面候选首张) */
  coverUrl?: string | null;
}

/** 组装可直发包(纯函数)。缺件不报错,写进 warnings,ready=false。 */
export function buildPublishPackage(
  spec: PlatformSpec,
  pack: PlatformPack | null,
  media: PublishMedia,
): PublishPackage {
  const warnings: string[] = [];

  const titles = pack?.titles?.filter(Boolean) ?? [];
  const title = titles[0] || '';
  if (!title) warnings.push('缺标题 —— 先生成分发文案');
  else if (title.length > spec.titleMaxLen) warnings.push(`标题超 ${spec.label} 上限(${spec.titleMaxLen})`);

  const platformVideo = media.platformVideoUrl || null;
  const video = platformVideo || media.finalVideoUrl || null;
  if (!video) warnings.push('缺成片 —— 先出片');
  else if (!platformVideo) warnings.push(`未导出 ${spec.aspect} 平台成片(可一键导出该比例)`);

  const cover = media.coverUrl || null;
  if (!cover) warnings.push('缺封面 —— 可生成封面候选');

  const tags = (pack?.tags ?? []).slice(0, spec.tagCount);
  const hashtags = tags.map((t) => '#' + t).join(' ');
  const description = pack?.description ?? '';
  const copyText = [title, hashtags, description].filter(Boolean).join('\n');

  return {
    platform: spec.id,
    label: spec.label,
    spec: { aspect: spec.aspect, titleMaxLen: spec.titleMaxLen, tagCount: spec.tagCount, descMaxLen: spec.descMaxLen },
    title,
    titleAlternatives: titles.slice(1),
    tags,
    hashtags,
    description,
    tips: pack?.tips ?? '',
    video: { url: video, recommendedAspect: spec.aspect, platformReady: !!platformVideo },
    cover: { url: cover },
    copyText,
    ready: !!title && !!video && !!cover,
    warnings,
  };
}
