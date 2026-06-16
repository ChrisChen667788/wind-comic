/**
 * lib/repos/publish-record-repo (v12.3.1) — 发布记录仓库(阶段二十二)。
 * 一次「发布」动作落一行;dashboard 读它显示发布状态。SQLite/PG 双驱动。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export type PublishStatus = 'packaged' | 'published' | 'scheduled' | 'failed';

export interface PublishRecord {
  id: string;
  projectId: string;
  platform: string;
  status: PublishStatus;
  shareUrl: string;
  title: string;
  externalUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string; project_id: string; platform: string; status: string;
  share_url: string; title: string; external_url: string | null;
  published_at: string | null; created_at: string;
}

function toRecord(r: Row): PublishRecord {
  return {
    id: r.id, projectId: r.project_id, platform: r.platform, status: r.status as PublishStatus,
    shareUrl: r.share_url, title: r.title, externalUrl: r.external_url,
    publishedAt: r.published_at, createdAt: r.created_at,
  };
}

export async function recordPublish(input: {
  projectId: string;
  platform: string;
  status?: PublishStatus;
  shareUrl?: string;
  title?: string;
  externalUrl?: string | null;
  publishedAt?: string | null;
}): Promise<PublishRecord> {
  const id = 'pub_' + nanoid(12);
  const ts = new Date().toISOString();
  const status = input.status ?? 'packaged';
  await getDbDriver().run(
    `INSERT INTO publish_records (id, project_id, platform, status, share_url, title, external_url, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.projectId, input.platform, status, input.shareUrl ?? '', input.title ?? '',
     input.externalUrl ?? null, input.publishedAt ?? (status === 'published' ? ts : null), ts],
  );
  const row = await getDbDriver().get<Row>('SELECT * FROM publish_records WHERE id = ?', [id]);
  if (!row) throw new Error('recordPublish: 插入后读取失败');
  return toRecord(row);
}

/** 列项目的发布记录(新到旧)。 */
export async function listPublishRecords(projectId: string): Promise<PublishRecord[]> {
  const rows = await getDbDriver().query<Row>(
    'SELECT * FROM publish_records WHERE project_id = ? ORDER BY created_at DESC',
    [projectId],
  );
  return rows.map(toRecord);
}
