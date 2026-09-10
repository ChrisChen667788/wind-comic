/**
 * 分享页的分镜清点(v12.432)。
 *
 * 修前标题写的是 `分镜 ({videoRows.length})` —— DB 里的**行数**;
 * 但渲染时 `if (!url) return null`,没出片的镜头整格消失。
 * 外部访客(客户)看到「分镜 (10)」却只数得出 4 个播放器,
 * 不知道是没生成完还是页面坏了。分享页是拿出去给人看的,这种账不能糊。
 *
 * 清点和标题都收在这里:数出片的,缺的也留一格。
 */
export interface ShareShotRow {
  shot_number: number;
  media_urls?: string | null;
  persistent_url?: string | null;
}

export interface ShareShot {
  shotNumber: number;
  /** 空串表示这镜没出片 —— 调用方要留格子,不许 return null */
  url: string;
}

function firstUrl(mediaUrls: string | null | undefined): string {
  if (!mediaUrls) return '';
  try {
    const arr = JSON.parse(mediaUrls);
    return Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : '';
  } catch {
    return '';
  }
}

export function toShareShots(rows: ShareShotRow[]): ShareShot[] {
  return rows.map((r) => ({
    shotNumber: r.shot_number,
    url: r.persistent_url || firstUrl(r.media_urls) || '',
  }));
}

export function playableShotCount(shots: ShareShot[]): number {
  return shots.filter((s) => s.url).length;
}

/** 标题里的那个数:全出齐了写总数,没齐就写「已出片 N/M」。 */
export function shareShotsLabel(shots: ShareShot[]): string {
  const playable = playableShotCount(shots);
  return playable < shots.length ? `已出片 ${playable}/${shots.length}` : String(shots.length);
}
