/**
 * 多集生成(阶段二十六)—— 系列剧落库(DbDriver,SQLite/PG 双驱)。
 * 剧集 = projects 行 + series_id/episode_number(v12.17.0 加列)。
 */
import { getDbDriver, isUniqueViolation } from '@/lib/db-driver';
import type { EpisodeShellSpec } from '@/lib/series';

export interface EpisodeRow {
  id: string;
  title: string;
  status: string;
  series_id: string | null;
  episode_number: number | null;
  aspect: string | null;
}

/** 插入一集剧集 shell(draft 状态,继承锚点一致性资产 + series_id/episode_number)。 */
export async function insertEpisodeProject(input: {
  id: string;
  userId: string;
  spec: EpisodeShellSpec;
}): Promise<void> {
  const driver = getDbDriver();
  const ts = new Date().toISOString();
  const s = input.spec;
  await driver.run(
    `INSERT INTO projects
       (id, user_id, title, description, cover_urls, status, aspect, style_id, primary_character_ref, locked_characters, series_id, episode_number, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id, input.userId, s.title, s.description || null,
      JSON.stringify([]), 'draft',
      s.aspect, s.styleId, s.primaryCharacterRef,
      s.lockedCharacters || JSON.stringify([]),
      s.seriesId, s.episodeNumber, ts, ts,
    ],
  );
}

/** 把一个已有项目接成系列的锚点集(ep1):写 series_id + episode_number(缺省 1)。 */
export async function linkAnchorEpisode(projectId: string, seriesId: string, userId: string): Promise<boolean> {
  const driver = getDbDriver();
  // v12.23.0(评审):锚点强制为第 1 集(直接赋 1,不用 COALESCE);否则若锚点曾属别的系列、
  // 已有集号(如 3),会保留 3 → 本系列集号错乱。
  const r = await driver.run(
    `UPDATE projects SET series_id = ?, episode_number = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
    [seriesId, new Date().toISOString(), projectId, userId],
  );
  return ((r as any)?.changes ?? 0) > 0;
}

/** 列出某系列全部剧集(按集号升序),限本人。 */
export async function listSeriesEpisodes(seriesId: string, userId: string): Promise<EpisodeRow[]> {
  const driver = getDbDriver();
  const rows = await driver.query(
    `SELECT id, title, status, series_id, episode_number, aspect
       FROM projects WHERE series_id = ? AND user_id = ?
       ORDER BY episode_number ASC`,
    [seriesId, userId],
  );
  return rows as EpisodeRow[];
}

export interface EpisodeFullRow extends EpisodeRow {
  description: string | null;
  style_id: string | null;
  primary_character_ref: string | null;
  locked_characters: string | null;
}

/** 列出某系列全部剧集(含生成所需的 premise + 继承一致性字段),按集号升序,限本人。 */
export async function listSeriesEpisodesFull(seriesId: string, userId: string): Promise<EpisodeFullRow[]> {
  const driver = getDbDriver();
  const rows = await driver.query(
    `SELECT id, title, status, series_id, episode_number, aspect, description, style_id, primary_character_ref, locked_characters
       FROM projects WHERE series_id = ? AND user_id = ?
       ORDER BY episode_number ASC`,
    [seriesId, userId],
  );
  return rows as EpisodeFullRow[];
}

/** 设置某剧集状态(批量生成进度:draft→active→completed)。 */
export async function setEpisodeStatus(projectId: string, status: string): Promise<void> {
  const driver = getDbDriver();
  await driver.run(
    `UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`,
    [status, new Date().toISOString(), projectId],
  );
}

export interface SeriesSummary {
  seriesId: string;
  episodeCount: number;
  doneCount: number;
  sampleTitle: string;
  updatedAt: string;
}

/** 列出本人名下所有系列(按最近更新),带集数/已完成数/样例标题(供「我的系列」入口)。 */
export async function listUserSeries(userId: string): Promise<SeriesSummary[]> {
  const driver = getDbDriver();
  const rows = await driver.query(
    `SELECT series_id AS seriesId, COUNT(*) AS episodeCount,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS doneCount,
            MIN(title) AS sampleTitle, MAX(updated_at) AS updatedAt
       FROM projects
      WHERE series_id IS NOT NULL AND user_id = ?
      GROUP BY series_id
      ORDER BY MAX(updated_at) DESC`,
    [userId],
  );
  return (rows as any[]).map((r) => ({
    seriesId: String(r.seriesId),
    episodeCount: Number(r.episodeCount) || 0,
    doneCount: Number(r.doneCount) || 0,
    sampleTitle: r.sampleTitle || '',
    updatedAt: r.updatedAt || '',
  }));
}

/** 系列已有的最大集号(用于追加新集时续号);无则 0。 */
export async function maxEpisodeNumber(seriesId: string, userId: string): Promise<number> {
  const driver = getDbDriver();
  const rows = await driver.query(
    `SELECT episode_number FROM projects WHERE series_id = ? AND user_id = ?`,
    [seriesId, userId],
  );
  let max = 0;
  for (const r of rows as any[]) {
    const n = Number(r.episode_number) || 0;
    if (n > max) max = n;
  }
  return max;
}

// ── v12.181:series 级一致性锚点(跨集传播:角色图/styleBible/上集末帧)──
export interface SeriesAnchor {
  lockedCharacters?: Array<{ name: string; imageUrl: string; role?: string; cw?: number }>;
  styleAnchorUrl?: string;
  lastEpisodeEndFrame?: string;
  fromEpisode?: number;
}

export async function getSeriesAnchor(seriesId: string): Promise<SeriesAnchor | null> {
  const row = (await getDbDriver().get('SELECT data FROM series_anchors WHERE series_id = ?', [seriesId])) as { data?: string } | undefined;
  try { return row?.data ? JSON.parse(row.data) : null; } catch { return null; }
}

export async function setSeriesAnchor(seriesId: string, anchor: SeriesAnchor): Promise<void> {
  const ts = new Date().toISOString();
  const json = JSON.stringify(anchor);
  // v12.306:与 upsertAsset(v12.303)同一个病 —— UPDATE-then-INSERT 之间没有互斥。
  // series_anchors.series_id 是主键,批量多集生成时两集几乎同时完成:
  // 两次 UPDATE 都命中 0 行 → 两次 INSERT,后者**抛主键冲突** → 那一集的 job 被标 failed,
  // 剧集管理页显示某集出错,而它的视频其实早就好了。
  // 修法同上:两步进同一事务;真撞上冲突就说明另一方抢先插入了,改为更新它。
  await getDbDriver().transaction(async (tx) => {
    const r = await tx.run('UPDATE series_anchors SET data = ?, updated_at = ? WHERE series_id = ?', [json, ts, seriesId]);
    if (r.changes) return;
    try {
      await tx.run('INSERT INTO series_anchors (series_id, data, updated_at) VALUES (?, ?, ?)', [seriesId, json, ts]);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      await tx.run('UPDATE series_anchors SET data = ?, updated_at = ? WHERE series_id = ?', [json, ts, seriesId]);
    }
  });
}
