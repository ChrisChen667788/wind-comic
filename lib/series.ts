/**
 * 多集生成(阶段二十六 · v12.17.0)—— 系列剧规划(纯函数)。
 *
 * 痛点:平台只能出单集;系列剧(同主角/同画风、多集)是竞品最大差距。本模块把「一句系列设定 +
 * 各集梗概」规划成多个**互相串联的剧集 shell**:同 seriesId、集号递增,且每集**继承锚点集的
 * 画风/锁脸/主角参考**(style_id/primary_character_ref/locked_characters)—— 这是跨集一致性
 * (第 2 集主角和第 1 集长一样)的关键。各集随后走既有单集管线生成,自然复用这些锚点。
 *
 * 纯函数,不碰网络/DB(落库在 lib/repos/series-repo)。
 */

import { normalizeVideoAspect } from '@/lib/video-aspect';

export interface EpisodeOutline {
  /** 本集标题(可空,自动「第 N 集」) */
  title?: string;
  /** 本集剧情梗概(必填) */
  premise: string;
}

/** 锚点集(通常第 1 集)的一致性资产 —— 后续各集继承,保跨集人物/画风一致。 */
export interface SeriesAnchor {
  aspect?: string;
  styleId?: string | null;
  primaryCharacterRef?: string | null;
  /** 锁定角色 JSON 串(原样透传) */
  lockedCharacters?: string | null;
}

export interface EpisodeShellSpec {
  episodeNumber: number;
  title: string;
  description: string;
  seriesId: string;
  aspect: string;
  styleId: string | null;
  primaryCharacterRef: string | null;
  lockedCharacters: string | null;
}

/** 剧集标题:「<系列> 第N集 [本集名]」。 */
export function seriesEpisodeTitle(seriesTitle: string, n: number, epTitle?: string): string {
  const base = (seriesTitle || '系列').trim();
  const ep = (epTitle || '').trim();
  return ep ? `${base} 第${n}集 ${ep}` : `${base} 第${n}集`;
}

export function validateSeriesInput(episodes: EpisodeOutline[]): { ok: boolean; error?: string } {
  if (!Array.isArray(episodes) || episodes.length === 0) return { ok: false, error: '至少需要 1 集' };
  if (episodes.length > 50) return { ok: false, error: '单系列最多 50 集' };
  if (episodes.some((e) => !e?.premise?.trim())) return { ok: false, error: '每集都需要 premise(剧情梗概)' };
  return { ok: true };
}

/** 规划系列:产出各集 shell 规格(集号递增 + 继承锚点一致性资产)。 */
export function buildSeriesPlan(input: {
  seriesId: string;
  seriesTitle: string;
  episodes: EpisodeOutline[];
  anchor?: SeriesAnchor;
  startEpisode?: number;
}): EpisodeShellSpec[] {
  const start = input.startEpisode && input.startEpisode > 0 ? Math.floor(input.startEpisode) : 1;
  const a = input.anchor || {};
  return (input.episodes || []).map((ep, i) => {
    const n = start + i;
    return {
      episodeNumber: n,
      title: seriesEpisodeTitle(input.seriesTitle, n, ep.title),
      description: (ep.premise || '').trim(),
      seriesId: input.seriesId,
      aspect: normalizeVideoAspect(a.aspect),
      styleId: a.styleId ?? null,
      primaryCharacterRef: a.primaryCharacterRef ?? null,
      lockedCharacters: a.lockedCharacters ?? null,
    };
  });
}

/** 从锚点集 id 派生稳定 seriesId(纯确定,不用随机)。 */
export function deriveSeriesId(anchorProjectId: string): string {
  return `series-${anchorProjectId}`;
}

/**
 * 批量生成时挑出「待生成」的剧集:默认取 'draft'(未开始)+ 'failed'(终态失败,可重试),
 * 跳过 'active'(生成中)/'completed'(已出)。force=true 时重生除「生成中」外的所有集。纯函数,便于单测。
 */
export function selectGeneratableEpisodes<T extends { status?: string }>(episodes: T[], opts: { force?: boolean } = {}): T[] {
  return (episodes || []).filter((e) =>
    opts.force ? e.status !== 'active' : (e.status === 'draft' || e.status === 'failed'),
  );
}
